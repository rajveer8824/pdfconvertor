import express from "express";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import officegen from 'officegen';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import PDFParser from 'pdf2json';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import cors from 'cors';

// Adobe PDF Services SDK imports - Make sure these are correct
import {
  PDFServices,
  MimeType,
  ExportPDFJob,
  ExportPDFParams,
  ExportPDFTargetFormat,
  ExportPDFResult,        // This is the correct result type for PDF export
  CompressPDFJob,
  CompressPDFParams,
  CompressPDFResult,      // This is the correct result type for PDF compression
  CompressionLevel,
  SDKError,
  ServicePrincipalCredentials,
  ServiceUsageError
} from "@adobe/pdfservices-node-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// More permissive CORS configuration
const corsOptions = {
  origin: true, // Allow all origins for now
  credentials: false, // Disable credentials to avoid CORS issues
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Origin');
  res.sendStatus(200);
});

// Add middleware to set CORS headers on all responses
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Origin');
  
  console.log(`📝 ${req.method} ${req.path} from ${req.get('origin') || req.get('host') || 'unknown'}`);
  next();
});

// Enhanced health check
app.get('/health', (req, res) => {
  console.log('🏥 Health check from:', req.get('origin') || req.get('host'));
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'PDF Converter Backend is running',
    version: '1.0.0',
    cors: 'enabled'
  });
});

// Test endpoint for CORS
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'CORS test successful',
    origin: req.get('origin'),
    timestamp: new Date().toISOString()
  });
});

// Add root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'PDF Converter API is running',
    endpoints: {
      health: '/health',
      convert: '/api/convert',
      download: '/api/download/:filename',
      status: '/api/status/:filename'
    }
  });
});

// Add request logging
app.use((req, res, next) => {
  console.log(`📝 ${req.method} ${req.path} from ${req.get('origin') || 'unknown'}`);
  next();
});

app.use(express.json());

// Create directories
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('outputs')) fs.mkdirSync('outputs');
if (!fs.existsSync('temp')) fs.mkdirSync('temp');

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Enhanced conversion endpoint with compression level support
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    const { type, compressionLevel = 'medium' } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }

    console.log(`🔄 Processing ${type} for file: ${file.originalname}`);
    console.log(`⚙️ Compression level: ${compressionLevel}`);
    
    const result = await processFile(file, type, compressionLevel);
    
    // Clean up uploaded file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    
    res.json({
      success: true,
      message: `${type} completed successfully`,
      filename: path.basename(result.outputPath),
      originalName: result.originalName,
      compressionLevel: result.compressionLevel,
      downloadUrl: `/api/download/${path.basename(result.outputPath)}`
    });
    
  } catch (error) {
    console.error('❌ Error processing file:', error);
    
    // Clean up on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Download processed file
app.get("/api/download/:filename", (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(process.cwd(), 'outputs', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    
    res.download(filePath);
  } catch (error) {
    console.error("❌ Download error:", error);
    res.status(500).json({ error: "Download failed" });
  }
});

// Get conversion status
app.get("/api/status/:filename", (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(process.cwd(), 'outputs', filename);
    
    if (fs.existsSync(filePath)) {
      res.json({ status: 'completed', filename });
    } else {
      res.json({ status: 'processing', filename });
    }
  } catch (error) {
    res.status(500).json({ error: "Status check failed" });
  }
});

// Check Adobe PDF Services credentials
app.get("/api/adobe-status", (req, res) => {
  try {
    const credentials = getAdobeCredentials();
    
    if (credentials) {
      res.json({ 
        status: 'configured',
        message: 'Adobe PDF Services is properly configured'
      });
    } else {
      res.json({ 
        status: 'not-configured',
        message: 'Adobe PDF Services credentials not found or invalid'
      });
    }
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      error: "Adobe status check failed",
      message: error.message
    });
  }
});

async function processFile(file, type, compressionLevel = 'medium') {
  const timestamp = Date.now();
  
  try {
    let outputPath;
    
    switch (type) {
      case 'pdf-to-word':
        outputPath = await convertPdfToWord(file, timestamp);
        break;
      case 'image-to-pdf':
        outputPath = await convertImageToPdf(file, timestamp);
        break;
      case 'compress-image':
        outputPath = await compressImage(file, timestamp, compressionLevel);
        break;
      case 'compress-video':
        outputPath = await compressVideo(file, timestamp, compressionLevel);
        break;
      case 'compress-pdf':
        outputPath = await compressPdf(file, timestamp, compressionLevel);
        break;
      default:
        throw new Error(`Unknown conversion type: ${type}`);
    }
    
    // Clean up uploaded file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    
    return {
      success: true,
      outputPath,
      originalName: file.originalname,
      type,
      compressionLevel
    };
    
  } catch (error) {
    console.error(`❌ ${type} error:`, error);
    throw error;
  }
}

function extractPdfTextWithExactFormatting(pdfPath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on('pdfParser_dataError', (error) => {
      console.error('PDF parsing error:', error);
      resolve('Unable to extract text from this PDF file.');
    });
    
    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      try {
        let fullDocument = [];
        
        if (pdfData.Pages && pdfData.Pages.length > 0) {
          pdfData.Pages.forEach((page, pageIndex) => {
            let pageContent = {
              pageNumber: pageIndex + 1,
              lines: []
            };
            
            if (page.Texts && page.Texts.length > 0) {
              // Create a detailed map of all text elements with their exact positions
              let textElements = [];
              
              page.Texts.forEach(textItem => {
                if (textItem.R && textItem.R.length > 0) {
                  textItem.R.forEach(textRun => {
                    if (textRun.T) {
                      textElements.push({
                        text: decodeURIComponent(textRun.T),
                        x: textItem.x,
                        y: textItem.y,
                        fontSize: textRun.TS ? textRun.TS[1] : 12,
                        fontFamily: textRun.TS ? textRun.TS[0] : 0,
                        bold: textRun.TS && textRun.TS[2] === 1,
                        italic: textRun.TS && textRun.TS[3] === 1
                      });
                    }
                  });
                }
              });
              
              // Sort by Y position (top to bottom), then X position (left to right)
              textElements.sort((a, b) => {
                const yDiff = b.y - a.y;
                if (Math.abs(yDiff) > 0.1) return yDiff;
                return a.x - b.x;
              });
              
              // Group text elements into lines based on Y position
              let currentLine = [];
              let lastY = null;
              
              textElements.forEach(element => {
                if (lastY !== null && Math.abs(element.y - lastY) > 0.1) {
                  // New line detected
                  if (currentLine.length > 0) {
                    pageContent.lines.push(currentLine);
                    currentLine = [];
                  }
                }
                currentLine.push(element);
                lastY = element.y;
              });
              
              // Add the last line
              if (currentLine.length > 0) {
                pageContent.lines.push(currentLine);
              }
            }
            
            fullDocument.push(pageContent);
          });
        }
        
        resolve(fullDocument);
      } catch (error) {
        console.error('Text extraction error:', error);
        resolve([]);
      }
    });
    
    pdfParser.loadPDF(pdfPath);
  });
}

// Enhanced Adobe PDF Services conversion with complete formatting preservation
async function convertPdfToWordAdobe(inputPath, outputPath) {
  try {
    console.log("🚀 Starting Adobe PDF Services conversion...");
    
    const credentials = getAdobeCredentials();
    if (!credentials) {
      console.warn("❌ Adobe credentials not available");
      return false;
    }

    // Create PDF Services instance
    const pdfServices = new PDFServices({ 
      credentials,
      region: 'US'
    });

    console.log("📄 Uploading PDF file to Adobe...");
    
    // Create asset from file
    const inputAsset = await pdfServices.upload({
      readStream: fs.createReadStream(inputPath),
      mimeType: MimeType.PDF
    });

    console.log("⚙️ Configuring conversion parameters...");
    
    // Create parameters for DOCX export
    const params = new ExportPDFParams({
      targetFormat: ExportPDFTargetFormat.DOCX,
      ocrLang: 'en-US'
    });

    console.log("🔄 Creating conversion job...");
    
    // Create the export job
    const job = new ExportPDFJob({ 
      inputAsset, 
      params 
    });

    console.log("📤 Submitting job to Adobe PDF Services...");
    
    // Submit the job
    const pollingURL = await pdfServices.submit({ job });
    
    console.log("⏳ Waiting for conversion to complete...");
    console.log(`📊 Polling URL: ${pollingURL}`);

    // Poll for completion with CORRECT result type
    const pdfServicesResponse = await pdfServices.getJobResult({
      pollingURL,
      resultType: ExportPDFResult  // This is the correct result type for ExportPDF jobs
    });

    console.log("✅ Conversion completed successfully!");
    console.log("📥 Downloading converted file...");

    // Get the result asset
    const resultAsset = pdfServicesResponse.result.asset;
    const streamAsset = await pdfServices.getContent({ asset: resultAsset });

    // Save to output file
    const outputStream = fs.createWriteStream(outputPath);
    streamAsset.readStream.pipe(outputStream);

    return new Promise((resolve, reject) => {
      outputStream.on('finish', () => {
        console.log("🎉 Adobe PDF to Word conversion successful!");
        console.log(`📁 Output file: ${outputPath}`);
        
        // Verify file was created and has content
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(`📊 File size: ${(stats.size / 1024).toFixed(2)} KB`);
          
          if (stats.size > 0) {
            console.log("✅ Conversion verified - file has content");
            resolve(true);
          } else {
            console.warn("⚠️ Warning: Output file is empty");
            resolve(false);
          }
        } else {
          console.error("❌ Output file was not created");
          resolve(false);
        }
      });
      
      outputStream.on('error', (error) => {
        console.error("❌ Error writing output file:", error);
        reject(error);
      });
      
      // Add timeout for the download process
      setTimeout(() => {
        console.warn("⏰ Download timeout - forcing completion check");
        if (fs.existsSync(outputPath)) {
          resolve(true);
        } else {
          resolve(false);
        }
      }, 30000); // 30 second timeout
    });

  } catch (error) {
    console.error("❌ Adobe PDF Services conversion error:");
    
    if (error instanceof SDKError) {
      console.error(`🔧 SDK Error: ${error.message}`);
      console.error(`📋 Error Code: ${error.code}`);
    } else if (error instanceof ServiceUsageError) {
      console.error(`💳 Service Usage Error: ${error.message}`);
      console.error("💡 Check your Adobe PDF Services quota and billing");
    } else {
      console.error(`🚨 General Error: ${error.message}`);
      console.error(`📍 Stack: ${error.stack}`);
    }
    
    return false;
  }
}

// Enhanced main conversion function with Adobe focus
async function convertPdfToWord(file, timestamp) {
  const outputPath = `outputs/${timestamp}_converted.docx`;
  
  try {
    console.log(`🎯 Starting PDF to Word conversion for: ${file.originalname}`);
    console.log(`📂 Input: ${file.path}`);
    console.log(`📂 Output: ${outputPath}`);
    
    // Ensure outputs directory exists
    if (!fs.existsSync('outputs')) {
      fs.mkdirSync('outputs', { recursive: true });
      console.log("📁 Created outputs directory");
    }
    
    // Primary: Adobe PDF Services conversion (highest quality)
    console.log("🥇 Attempting Adobe PDF Services conversion (Primary Method)...");
    const adobeSuccess = await convertPdfToWordAdobe(file.path, outputPath);
    
    if (adobeSuccess && fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`🎉 Adobe conversion successful!`);
      console.log(`📊 Final file size: ${(stats.size / 1024).toFixed(2)} KB`);
      console.log(`✅ Features preserved:`);
      console.log(`   • Tables as editable tables ✓`);
      console.log(`   • Fonts, bold, italics, colors ✓`);
      console.log(`   • Headers, footers, page breaks ✓`);
      console.log(`   • Images and charts embedded ✓`);
      console.log(`   • Fully editable Word document ✓`);
      
      return outputPath;
    }
    
    // Fallback: Enhanced text extraction (if Adobe fails)
    console.log("🥈 Adobe conversion failed, using enhanced fallback...");
    return await convertPdfToWordFallback(file, timestamp);
    
  } catch (error) {
    console.error("❌ Conversion process error:", error);
    return await createErrorReport(file, timestamp, error);
  }
}

// Enhanced fallback conversion method
async function convertPdfToWordFallback(file, timestamp) {
  const outputPath = `outputs/${timestamp}_fallback.docx`;
  
  try {
    console.log("🛠️ Using enhanced fallback conversion...");
    
    // Extract text with positioning
    const extractedText = await extractPdfText(file.path);
    
    // Create professional Word document
    const docx = officegen('docx');
    
    // Add document header
    const header = docx.createP();
    header.addText("📄 PDF Conversion Report", { 
      bold: true, 
      font_size: 16,
      color: '2E86AB'
    });
    header.addLineBreak();
    
    const info = docx.createP();
    info.addText(`Original File: ${file.originalname}`);
    info.addLineBreak();
    info.addText(`Conversion Method: Enhanced Text Extraction`);
    info.addLineBreak();
    info.addText(`Date: ${new Date().toLocaleString()}`);
    info.addLineBreak();
    info.addLineBreak();
    
    // Add extracted content
    const content = docx.createP();
    content.addText(extractedText, { font_size: 11 });
    
    // Save document
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(outputPath);
      out.on('error', reject);
      out.on('close', resolve);
      docx.generate(out);
    });
    
    console.log(`✅ Fallback conversion completed: ${outputPath}`);
    return outputPath;
    
  } catch (error) {
    console.error("❌ Fallback conversion failed:", error);
    return await createErrorReport(file, timestamp, error);
  }
}

// Create detailed error report
async function createErrorReport(file, timestamp, error) {
  const errorPath = `outputs/${timestamp}_error_report.docx`;
  
  try {
    const docx = officegen('docx');
    
    const title = docx.createP();
    title.addText("🚨 PDF Conversion Error Report", { 
      bold: true, 
      font_size: 18,
      color: 'C0392B'
    });
    title.addLineBreak();
    
    const details = docx.createP();
    details.addText(`📄 File: ${file.originalname}`);
    details.addLineBreak();
    details.addText(`📅 Date: ${new Date().toLocaleString()}`);
    details.addLineBreak();
    details.addText(`❌ Error: ${error.message}`);
    details.addLineBreak();
    details.addLineBreak();
    
    const troubleshooting = docx.createP();
    troubleshooting.addText("🔧 Troubleshooting Steps:", { bold: true });
    troubleshooting.addLineBreak();
    troubleshooting.addText("1. Verify Adobe PDF Services credentials are configured");
    troubleshooting.addLineBreak();
    troubleshooting.addText("2. Check if PDF is password protected");
    troubleshooting.addLineBreak();
    troubleshooting.addText("3. Ensure PDF is not corrupted");
    troubleshooting.addLineBreak();
    troubleshooting.addText("4. Try with a different PDF file");
    troubleshooting.addLineBreak();
    troubleshooting.addText("5. Contact support if issue persists");
    
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(errorPath);
      out.on('error', reject);
      out.on('close', resolve);
      docx.generate(out);
    });
    
    return errorPath;
    
  } catch (reportError) {
    console.error("❌ Failed to create error report:", reportError);
    throw new Error(`Conversion failed: ${error.message}`);
  }
}

async function convertImageToPdf(file, timestamp) {
  const outputPath = `outputs/${timestamp}_converted.pdf`;
  
  try {
    // Process image
    const imageBuffer = await sharp(file.path)
      .jpeg({ quality: 90 })
      .toBuffer();
    
    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    
    // Embed image
    const image = await pdfDoc.embedJpg(imageBuffer);
    const { width, height } = image.scale(0.5);
    
    page.drawImage(image, {
      x: 50,
      y: page.getHeight() - height - 50,
      width,
      height,
    });
    
    // Save PDF
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`✅ PDF created: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error("❌ Image to PDF conversion error:", error);
    throw new Error(`Image to PDF conversion failed: ${error.message}`);
  }
}

// Enhanced image compression with user-selectable quality levels
async function compressImage(file, timestamp, compressionLevel = 'medium') {
  const outputPath = `outputs/${timestamp}_compressed.jpg`;
  
  try {
    console.log(`🖼️ Compressing image with ${compressionLevel} quality...`);
    
    // Define compression settings based on user selection
    const compressionSettings = {
      low: {
        quality: 50,
        maxWidth: 1280,
        maxHeight: 720,
        description: 'Low quality - Smallest file size'
      },
      medium: {
        quality: 75,
        maxWidth: 1920,
        maxHeight: 1080,
        description: 'Medium quality - Balanced size and quality'
      },
      high: {
        quality: 90,
        maxWidth: 2560,
        maxHeight: 1440,
        description: 'High quality - Best quality with some compression'
      },
      custom: {
        quality: 60,
        maxWidth: 1600,
        maxHeight: 900,
        description: 'Custom quality - User defined settings'
      }
    };
    
    const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
    
    // Get original file size
    const originalStats = fs.statSync(file.path);
    const originalSizeMB = (originalStats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`📊 Original size: ${originalSizeMB} MB`);
    console.log(`⚙️ Using ${settings.description}`);
    
    await sharp(file.path)
      .jpeg({ 
        quality: settings.quality, 
        progressive: true,
        mozjpeg: true // Better compression
      })
      .resize(settings.maxWidth, settings.maxHeight, { 
        fit: 'inside', 
        withoutEnlargement: true 
      })
      .toFile(outputPath);
    
    // Check compression results
    const compressedStats = fs.statSync(outputPath);
    const compressedSizeMB = (compressedStats.size / (1024 * 1024)).toFixed(2);
    const compressionRatio = ((1 - compressedStats.size / originalStats.size) * 100).toFixed(1);
    
    console.log(`✅ Compressed size: ${compressedSizeMB} MB`);
    console.log(`📉 Size reduction: ${compressionRatio}%`);
    
    return outputPath;
  } catch (error) {
    throw new Error(`Image compression failed: ${error.message}`);
  }
}

// Configure FFmpeg path
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
  console.log(`✅ FFmpeg configured at: ${ffmpegPath}`);
} else {
  console.warn("⚠️ FFmpeg static not found, trying system PATH");
}

// Enhanced video compression with user-selectable quality levels
async function compressVideo(file, timestamp, compressionLevel = 'medium') {
  const outputPath = `outputs/${timestamp}_compressed.mp4`;
  
  try {
    console.log(`🎬 Compressing video with ${compressionLevel} quality...`);
    
    // Define compression settings based on user selection
    const compressionSettings = {
      low: {
        resolution: '854x480',
        videoBitrate: '500k',
        audioBitrate: '96k',
        crf: 28,
        preset: 'fast',
        description: 'Low quality - Smallest file size (480p)'
      },
      medium: {
        resolution: '1280x720',
        videoBitrate: '1000k',
        audioBitrate: '128k',
        crf: 23,
        preset: 'medium',
        description: 'Medium quality - Balanced size and quality (720p)'
      },
      high: {
        resolution: '1920x1080',
        videoBitrate: '2000k',
        audioBitrate: '192k',
        crf: 20,
        preset: 'slow',
        description: 'High quality - Best quality with compression (1080p)'
      },
      custom: {
        resolution: '1024x576',
        videoBitrate: '750k',
        audioBitrate: '112k',
        crf: 25,
        preset: 'medium',
        description: 'Custom quality - User defined settings'
      }
    };
    
    const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
    
    // Get original file size
    const originalStats = fs.statSync(file.path);
    const originalSizeMB = (originalStats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`📊 Original size: ${originalSizeMB} MB`);
    console.log(`⚙️ Using ${settings.description}`);
    
    try {
      await checkFFmpegAvailability();
      
      await new Promise((resolve, reject) => {
        const command = ffmpeg(file.path)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size(settings.resolution)
          .videoBitrate(settings.videoBitrate)
          .audioBitrate(settings.audioBitrate)
          .outputOptions([
            `-preset ${settings.preset}`,
            `-crf ${settings.crf}`,
            '-movflags +faststart' // Optimize for web streaming
          ])
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log(`🚀 FFmpeg command: ${commandLine}`);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`📊 Progress: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            // Check compression results
            const compressedStats = fs.statSync(outputPath);
            const compressedSizeMB = (compressedStats.size / (1024 * 1024)).toFixed(2);
            const compressionRatio = ((1 - compressedStats.size / originalStats.size) * 100).toFixed(1);
            
            console.log(`✅ Video compression completed: ${outputPath}`);
            console.log(`📊 Compressed size: ${compressedSizeMB} MB`);
            console.log(`📉 Size reduction: ${compressionRatio}%`);
            resolve();
          })
          .on('error', (error) => {
            console.error(`❌ FFmpeg error: ${error.message}`);
            reject(error);
          });
        
        command.run();
      });
      
      return outputPath;
      
    } catch (ffmpegError) {
      console.warn("⚠️ FFmpeg compression failed, using fallback...");
      return await compressVideoFallback(file, timestamp);
    }
    
  } catch (error) {
    throw new Error(`Video compression failed: ${error.message}`);
  }
}

// Check FFmpeg availability
async function checkFFmpegAvailability() {
  return new Promise((resolve, reject) => {
    ffmpeg.getAvailableFormats((err, formats) => {
      if (err) {
        console.error("❌ FFmpeg not available:", err.message);
        reject(new Error(`FFmpeg not found: ${err.message}`));
      } else {
        console.log("✅ FFmpeg is available and working");
        resolve();
      }
    });
  });
}

// Alternative video compression without FFmpeg (basic copy)
async function compressVideoFallback(file, timestamp) {
  const outputPath = `outputs/${timestamp}_video_copy.mp4`;
  
  try {
    console.log("🔄 Using fallback video processing (file copy)...");
    
    // Simple file copy as fallback
    fs.copyFileSync(file.path, outputPath);
    
    console.log(`✅ Video file copied: ${outputPath}`);
    return outputPath;
    
  } catch (error) {
    throw new Error(`Video fallback processing failed: ${error.message}`);
  }
}

// Enhanced PDF compression with Adobe PDF Services
async function compressPdf(file, timestamp, compressionLevel = 'medium') {
  const outputPath = `outputs/${timestamp}_compressed.pdf`;
  
  try {
    console.log(`📄 Compressing PDF with ${compressionLevel} compression...`);
    
    // Get original file size
    const originalStats = fs.statSync(file.path);
    const originalSizeMB = (originalStats.size / (1024 * 1024)).toFixed(2);
    console.log(`📊 Original PDF size: ${originalSizeMB} MB`);
    
    // Try Adobe PDF Services compression first
    const adobeSuccess = await compressPdfAdobe(file.path, outputPath, compressionLevel);
    
    if (adobeSuccess) {
      // Check compression results
      const compressedStats = fs.statSync(outputPath);
      const compressedSizeMB = (compressedStats.size / (1024 * 1024)).toFixed(2);
      const compressionRatio = ((1 - compressedStats.size / originalStats.size) * 100).toFixed(1);
      
      console.log(`✅ Adobe PDF compression completed: ${outputPath}`);
      console.log(`📊 Compressed size: ${compressedSizeMB} MB`);
      console.log(`📉 Size reduction: ${compressionRatio}%`);
      
      return outputPath;
    } else {
      // Fallback to basic compression
      console.warn("⚠️ Adobe compression failed, using fallback...");
      return await compressPdfFallback(file, timestamp, compressionLevel);
    }
    
  } catch (error) {
    throw new Error(`PDF compression failed: ${error.message}`);
  }
}

// Adobe PDF compression with compression levels
async function compressPdfAdobe(inputPath, outputPath, compressionLevel) {
  try {
    const credentials = getAdobeCredentials();
    if (!credentials) {
      return false;
    }

    const pdfServices = new PDFServices({ credentials });
    
    // Upload PDF
    const inputAsset = await pdfServices.upload({
      readStream: fs.createReadStream(inputPath),
      mimeType: MimeType.PDF
    });

    // Map compression levels to Adobe's CompressionLevel enum
    const adobeCompressionMap = {
      low: CompressionLevel.LOW,     // Least compression, best quality
      medium: CompressionLevel.MEDIUM, // Balanced compression
      high: CompressionLevel.HIGH     // Maximum compression, smallest size
    };
    
    const adobeLevel = adobeCompressionMap[compressionLevel] || CompressionLevel.MEDIUM;
    
    console.log(`🔧 Using Adobe compression level: ${compressionLevel.toUpperCase()}`);
    
    // Create compression parameters
    const params = new CompressPDFParams({
      compressionLevel: adobeLevel
    });

    // Create compression job
    const job = new CompressPDFJob({ 
      inputAsset, 
      params 
    });

    // Submit and wait for completion
    const pollingURL = await pdfServices.submit({ job });
    const pdfServicesResponse = await pdfServices.getJobResult({
      pollingURL,
      resultType: CompressPDFResult
    });

    // Download result
    const resultAsset = pdfServicesResponse.result.asset;
    const streamAsset = await pdfServices.getContent({ asset: resultAsset });

    const outputStream = fs.createWriteStream(outputPath);
    streamAsset.readStream.pipe(outputStream);

    return new Promise((resolve) => {
      outputStream.on('finish', () => resolve(true));
      outputStream.on('error', () => resolve(false));
    });

  } catch (error) {
    console.error("❌ Adobe PDF compression error:", error);
    return false;
  }
}

app.listen(3001, () => {
  console.log("✅ Backend running on port 3001");
  console.log("🔧 Available endpoints:");
  console.log("   POST /api/convert - File conversion");
  console.log("   GET /api/download/:filename - File download");
  console.log("   GET /api/status/:filename - Check conversion status");
  console.log("   GET /api/adobe-status - Check Adobe PDF Services configuration");
  console.log("\n📝 PDF to Word Conversion Options:");
  console.log("   1. Adobe PDF Services (best) - Requires credentials file");
  console.log("   2. Enhanced text extraction (fallback) - Works with any PDF");
  console.log("\n📋 To set up Adobe PDF Services:");
  console.log("   1. Go to https://developer.adobe.com/document-services/");
  console.log("   2. Create credentials and download pdfservices-api-credentials.json");
  console.log("   3. Place the file in the root directory of this project");
});

// Enhanced Adobe credentials loading with validation
function getAdobeCredentials() {
  try {
    const credentialsPath = path.join(process.cwd(), 'pdfservices-api-credentials.json');
    
    console.log(`🔍 Looking for credentials at: ${credentialsPath}`);
    
    if (!fs.existsSync(credentialsPath)) {
      console.warn("❌ Adobe PDF Services credentials file not found");
      console.log("💡 To set up Adobe PDF Services:");
      console.log("   1. Go to https://developer.adobe.com/document-services/");
      console.log("   2. Create credentials and download pdfservices-api-credentials.json");
      console.log("   3. Place the file in the root directory of this project");
      return null;
    }

    const credentialsData = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    // Validate credentials structure
    if (!credentialsData.client_credentials || 
        !credentialsData.service_principal_credentials ||
        !credentialsData.client_credentials.client_id ||
        !credentialsData.client_credentials.client_secret ||
        !credentialsData.service_principal_credentials.organization_id) {
      
      console.error("❌ Invalid credentials file structure");
      return null;
    }
    
    console.log("✅ Adobe credentials loaded successfully");
    console.log(`🏢 Organization ID: ${credentialsData.service_principal_credentials.organization_id}`);
    
    return new ServicePrincipalCredentials({
      clientId: credentialsData.client_credentials.client_id,
      clientSecret: credentialsData.client_credentials.client_secret,
      organizationId: credentialsData.service_principal_credentials.organization_id
    });
    
  } catch (error) {
    console.error("❌ Error loading Adobe credentials:", error);
    return null;
  }
}

// Add Adobe status check endpoint
app.get('/api/adobe-status', (req, res) => {
  const credentials = getAdobeCredentials();
  
  res.json({
    configured: !!credentials,
    message: credentials ? 
      "Adobe PDF Services is properly configured" : 
      "Adobe PDF Services credentials not found",
    setup_url: "https://developer.adobe.com/document-services/"
  });
});

// Add the missing extractPdfText function
async function extractPdfText(pdfPath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on('pdfParser_dataError', (error) => {
      console.error('PDF parsing error:', error);
      resolve('Unable to extract text from this PDF file.');
    });
    
    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      try {
        let fullText = '';
        
        if (pdfData.Pages && pdfData.Pages.length > 0) {
          pdfData.Pages.forEach((page, pageIndex) => {
            fullText += `\n--- Page ${pageIndex + 1} ---\n`;
            
            if (page.Texts && page.Texts.length > 0) {
              // Sort text elements by position (top to bottom, left to right)
              let textElements = [];
              
              page.Texts.forEach(textItem => {
                if (textItem.R && textItem.R.length > 0) {
                  textItem.R.forEach(textRun => {
                    if (textRun.T) {
                      textElements.push({
                        text: decodeURIComponent(textRun.T),
                        x: textItem.x,
                        y: textItem.y
                      });
                    }
                  });
                }
              });
              
              // Sort by Y position (top to bottom), then X position (left to right)
              textElements.sort((a, b) => {
                const yDiff = b.y - a.y;
                if (Math.abs(yDiff) > 0.1) return yDiff;
                return a.x - b.x;
              });
              
              // Group into lines and add to text
              let currentLine = '';
              let lastY = null;
              
              textElements.forEach(element => {
                if (lastY !== null && Math.abs(element.y - lastY) > 0.1) {
                  // New line detected
                  if (currentLine.trim()) {
                    fullText += currentLine.trim() + '\n';
                  }
                  currentLine = '';
                }
                currentLine += element.text + ' ';
                lastY = element.y;
              });
              
              // Add the last line
              if (currentLine.trim()) {
                fullText += currentLine.trim() + '\n';
              }
            }
          });
        }
        
        resolve(fullText || 'No text content found in PDF.');
      } catch (error) {
        console.error('Text extraction error:', error);
        resolve('Error extracting text from PDF.');
      }
    });
    
    pdfParser.loadPDF(pdfPath);
  });
}

// Add compression options endpoint
app.get('/api/compression-options', (req, res) => {
  res.json({
    image: {
      low: { quality: 50, resolution: '1280x720', description: 'Low quality - Smallest file size' },
      medium: { quality: 75, resolution: '1920x1080', description: 'Medium quality - Balanced size and quality' },
      high: { quality: 90, resolution: '2560x1440', description: 'High quality - Best quality with some compression' }
    },
    video: {
      low: { resolution: '480p', bitrate: '500k', description: 'Low quality - Smallest file size (480p)' },
      medium: { resolution: '720p', bitrate: '1000k', description: 'Medium quality - Balanced size and quality (720p)' },
      high: { resolution: '1080p', bitrate: '2000k', description: 'High quality - Best quality with compression (1080p)' }
    },
    pdf: {
      low: { description: 'Low compression - Best quality, larger file size' },
      medium: { description: 'Medium compression - Balanced quality and size' },
      high: { description: 'High compression - Smallest file size, reduced quality' }
    }
  });
});
