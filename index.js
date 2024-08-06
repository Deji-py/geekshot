import express from "express";
import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

let chrome = {};
let puppeteer;


const app = express();
const port = process.env.PORT || 6000;

// Configure AWS S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// In-memory cache
const cache = {};

const blocked_domains = [
  'googlesyndication.com',
  'adservice.google.com',
];

// Capture screenshot of a webpage
const captureScreenshot = async (url) => {
  let options = {};

    const minimal_args = [
  '--autoplay-policy=user-gesture-required',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-dev-shm-usage',
  '--disable-domain-reliability',
  '--disable-extensions',
  '--disable-features=AudioServiceOutOfProcess',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-notifications',
  '--disable-offer-store-unmasked-wallet-cards',
  '--disable-popup-blocking',
  '--disable-print-preview',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-setuid-sandbox',
  '--disable-speech-api',
  '--disable-sync',
  '--hide-scrollbars',
  '--ignore-gpu-blacklist',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-first-run',
  '--no-pings',
  '--no-sandbox',
  '--no-zygote',
  '--password-store=basic',
  '--use-gl=swiftshader',
  '--use-mock-keychain',
];
    options = {
      args: [ "--hide-scrollbars", "--disable-web-security", ...minimal_args],
      headless: true,
      ignoreHTTPSErrors: true,
      userDataDir: './my/path'
}
  
  try {
    const browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
page.on('request', request => {
  const url = request.url()
  if (blocked_domains.some(domain => url.includes(domain))) {
    request.abort();
  } else {
    request.continue();
  }
});
    await page.goto(url, { waitUntil: "networkidle2" }); // Wait until the network is idle
    const screenshotBuffer = await page.screenshot();
    await browser.close();
    return screenshotBuffer;
  } catch (error) {
    throw new Error(`Error capturing screenshot: ${error.message}`);
  }
};

// Upload file to S3
const uploadToS3 = async (buffer, filename) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: filename,
    Body: buffer,
    ContentType: "image/png",
  };

  try {
    const command = new PutObjectCommand(params);
    await s3Client.send(command);
    return `https://${params.Bucket}.s3.amazonaws.com/${params.Key}`;
  } catch (error) {
    throw new Error(`Error uploading to S3: ${error.message}`);
  }
};

// Get favicon URL
const getFaviconUrl = async (url) => {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const faviconUrlMatch = html.match(
      /<link.*?rel=["']?icon["']?.*?href=["']?([^"'>]+)["']?/i
    );
    if (faviconUrlMatch && faviconUrlMatch[1]) {
      return faviconUrlMatch[1];
    }
    return null; // No favicon found
  } catch (error) {
    throw new Error(`Error fetching favicon: ${error.message}`);
  }
};

// Route to capture screenshot
app.get("/capture", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("URL is required");
  }

  // Check if the data is in the cache
  if (cache[url]) {
    return res.json(cache[url]);
  }

  try {
    const screenshotBuffer = await captureScreenshot(url);
    const faviconUrl = await getFaviconUrl(url);
    const screenshotFilename = `screenshots/${uuidv4()}.png`;
    const screenshotUrl = await uploadToS3(
      screenshotBuffer,
      screenshotFilename
    );

    // Store in cache
    const response = { screenshotUrl, faviconUrl };
    cache[url] = response;

    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || "An error occurred");
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
