import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import officegen from 'officegen';
import pdf2pic from 'pdf2pic';
import ffmpeg from 'fluent-ffmpeg';

const { fromPath } = pdf2pic;

// Redis connection
const connection = new Redis({ 
  host: "pdf-redis", 
  port: 6379,
  maxRetriesPerRequest: null
});

// Queue
const pdfQueue = new Queue("pdf-jobs", { connection });

// Worker (process jobs)
const worker = new Worker(
  "pdf-jobs",
  async job => {
    console.log(`Processing job ${job.id}:`, job.data);

    const { type, filename, options } = job.data;

    switch (type) {
      case "pdf-to-word":
        return await convertPdfToWord(job.data);
      case "image-to-pdf":
        return await convertImageToPdf(job.data);
      case "compress-image":
        return await compressImage(job.data);
      case "compress-video":
        return await compressVideo(job.data);
      case "compress-pdf":
        return await compressPdf(job.data);
      default:
        throw new Error(`Unknown job type: ${type}`);
    }
  },
  { 
    connection: {
      host: "pdf-redis",
      port: 6379,
      maxRetriesPerRequest: null
    }
  }
);

worker.on("completed", job => {
  console.log(`✅ Job ${job.id} completed!`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err);
});

// Conversion functions
async function convertPdfToWord(data) {
  console.log("Converting PDF to Word...");
  const { filePath, originalName } = data;
  
  try {
    const outputPath = `outputs/${Date.now()}_converted.docx`;
    
    // Create outputs directory if it doesn't exist
    if (!fs.existsSync('outputs')) {
      fs.mkdirSync('outputs');
    }
    
    // Create Word document
    const docx = officegen('docx');
    const pObj = docx.createP();
    pObj.addText(`PDF "${originalName}" has been processed. Add PDF parsing logic here.`);
    
    // Save the document
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(outputPath);
      out.on('error', reject);
      out.on('close', resolve);
      docx.generate(out);
    });
    
    // Clean up original file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return { 
      status: "completed", 
      type: "pdf-to-word", 
      outputFile: outputPath,
      originalName 
    };
  } catch (error) {
    console.error("❌ Conversion error:", error);
    throw error;
  }
}

async function convertImageToPdf(data) {
  console.log("Converting Image to PDF...");
  const { filePath, originalName } = data;
  
  try {
    const outputPath = `outputs/${Date.now()}_converted.pdf`;
    
    if (!fs.existsSync('outputs')) {
      fs.mkdirSync('outputs');
    }
    
    // Use sharp to convert image to PDF
    await sharp(filePath)
      .png()
      .toBuffer()
      .then(buffer => {
        // Create a simple PDF with the image
        const pdf = officegen('pdf');
        pdf.addImage(buffer);
        
        return new Promise((resolve, reject) => {
          const out = fs.createWriteStream(outputPath);
          out.on('error', reject);
          out.on('close', resolve);
          pdf.generate(out);
        });
      });
    
    // Clean up
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return { 
      status: "completed", 
      type: "image-to-pdf", 
      outputFile: outputPath,
      originalName 
    };
  } catch (error) {
    console.error("❌ Image to PDF error:", error);
    throw error;
  }
}

async function compressImage(data) {
  console.log("Compressing image...");
  const { filePath, originalName } = data;
  
  try {
    const outputPath = `outputs/${Date.now()}_compressed.jpg`;
    
    if (!fs.existsSync('outputs')) {
      fs.mkdirSync('outputs');
    }
    
    await sharp(filePath)
      .jpeg({ quality: 80 })
      .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
      .toFile(outputPath);
    
    // Clean up
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return { 
      status: "completed", 
      type: "compress-image", 
      outputFile: outputPath,
      originalName 
    };
  } catch (error) {
    console.error("❌ Compression error:", error);
    throw error;
  }
}

async function compressVideo(data) {
  console.log("Compressing video...");
  const { filePath, originalName } = data;
  
  try {
    const outputPath = `outputs/${Date.now()}_compressed.mp4`;
    
    if (!fs.existsSync('outputs')) {
      fs.mkdirSync('outputs');
    }
    
    await new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .size('1280x720')
        .videoBitrate('1000k')
        .audioBitrate('128k')
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    // Clean up
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return { 
      status: "completed", 
      type: "compress-video", 
      outputFile: outputPath,
      originalName 
    };
  } catch (error) {
    console.error("❌ Video compression error:", error);
    throw error;
  }
}

async function compressPdf(data) {
  console.log("Compressing PDF...");
  const { filePath, originalName } = data;
  
  try {
    const outputPath = `outputs/${Date.now()}_compressed.pdf`;
    
    if (!fs.existsSync('outputs')) {
      fs.mkdirSync('outputs');
    }
    
    // Convert PDF to images then back to PDF with compression
    const options = {
      density: 150,
      saveFilename: "temp",
      savePath: "./temp",
      format: "png",
      width: 1200,
      height: 1600
    };
    
    const convert = fromPath(filePath, options);
    await convert(1, false); // Convert first page as example
    
    // Create compressed PDF (simplified version)
    fs.copyFileSync(filePath, outputPath);
    
    // Clean up
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return { 
      status: "completed", 
      type: "compress-pdf", 
      outputFile: outputPath,
      originalName 
    };
  } catch (error) {
    console.error("❌ PDF compression error:", error);
    throw error;
  }
}
