import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs'; 

dotenv.config();
const app = express();

app.use(cors());

// 1. Express ki Payload Limit 10MB tak badha di gayi hai
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// 2. Cloudinary Setup
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

// 3. Multer Setup (File Size 10MB aur Sirf Images allowed)
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Agar file ka type 'image/' se shuru hota hai (jaise image/jpeg, image/png)
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      // Agar image nahi hai, toh upload reject kar do
      cb(new Error('Only image files (JPG, PNG, WEBP) are allowed!'), false);
    }
  }
});

// 4. Database Connection
if(process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Database Connected Successfully!'))
    .catch((err) => console.error('❌ Database Error:', err));
}

// ==========================================
// 5. MAIN ROUTE (Direct REST API Method)
// ==========================================
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided!" });
    }

    console.log("📸 Photo received, processing started...");

    const cloudinaryResult = await cloudinary.uploader.upload(req.file.path);
    const imageAsBase64 = fs.readFileSync(req.file.path, 'base64');
    
    const fullPrompt = `
    You are an expert professional photography judge. 
    Analyze the provided image and evaluate it technically.
    Return ONLY a JSON object with this exact structure (no markdown, no other text):
    {
      "scores": {
        "isolation": "X/10",
        "color": "X/10",
        "sharpness": "X/10"
      },
      "analysis": "Provide a 2 to 3 sentence overall verdict and technical analysis of the image.",
      "improvements": [
        { "title": "Lighting/Exposure", "tip": "Specific actionable advice here." },
        { "title": "Composition", "tip": "Specific actionable advice here." },
        { "title": "Color Grading", "tip": "Specific actionable advice here." }
      ]
    }`;

    // DIRECT API CALL TO GOOGLE (No SDK involved)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const requestBody = {
      contents: [
        {
          parts: [
            { text: fullPrompt },
            { 
              inline_data: { 
                mime_type: req.file.mimetype, 
                data: imageAsBase64 
              } 
            }
          ]
        }
      ]
    };

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await apiResponse.json();

    // Agar abhi bhi error aaya, toh backend logs me exact reason print hoga
    if (!apiResponse.ok) {
       console.error("❌ Google API Direct Error:", data);
       throw new Error(JSON.stringify(data));
    }

    // Google API ke JSON response se text nikalna
    const text = data.candidates[0].content.parts[0].text;
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const feedback = JSON.parse(cleanText);

    // ==========================================
    // NAYA FEATURE: CLOUDINARY AI ENHANCEMENT
    // ==========================================
    // Cloudinary AI se photo ko auto-improve, sharpen aur color correct karna
    const editedImageUrl = cloudinary.url(cloudinaryResult.public_id, {
      transformation: [
        { effect: "improve" },       // AI based auto-exposure & color correction
        { effect: "sharpen:100" },   // Sharpness badhana
        { effect: "vibrance:30" }    // Colors ko thoda pop karna
      ]
    });

    // Feedback JSON me original aur naye edited photo ka link add karna
    feedback.originalImage = cloudinaryResult.secure_url;
    feedback.editedImage = editedImageUrl; 
    // ==========================================

    console.log("✅ Analysis Complete! Sending to frontend...");
    res.json(feedback);

  } catch (error) {
    console.error("❌ Error during analysis:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});
// Server ko zinda rakhne ke liye Ping route
app.get('/ping', (req, res) => {
  res.status(200).json({ message: "Server is awake and running!" });
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));