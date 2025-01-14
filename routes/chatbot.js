const express = require('express');
const axios = require('axios');
const router = express.Router();
const multer = require('multer');
const User= require('../models/User');
const sharp = require("sharp"); // Image processing library
const fs = require("fs");
const authenticateToken = require('../middlewares/auth'); 
require('dotenv').config();

const LAMBDA_API_URL =process.env.URILAMA


const upload = multer({ dest: 'uploads/' });
router.get('/',authenticateToken, async(req,res)=>{
const user= await User.findById(req.user.userId);
  res.render('chatbot',{user});

})




// Route for analyzing the image (existing endpoint)
router.post("/analyzePacket", upload.single("image"), async (req, res) => {
 
    const { file } = req;

    if (!file) {
        return res.status(400).json({ error: "No image file uploaded." });
    }

    const compressedFilePath = `./uploads/compressed_${file.filename}`;

    try {
        // Compress the uploaded image using Sharp
        await sharp(file.path)
            .resize({ width: 800 }) // Resize the image to a maximum width of 800px
            .toFormat("jpeg") // Ensure the output format is JPEG
            .jpeg({ quality: 80 }) // Set JPEG quality
            .toFile(compressedFilePath); // Save the compressed file

        // Read the compressed image file and convert it to Base64
        const imageBuffer = fs.readFileSync(compressedFilePath);
        const imageBase64 = imageBuffer.toString("base64");

    const visionResponse = await axios.post(
      "https://api.sambanova.ai/v1/chat/completions",
      {
        model: "Llama-3.2-11B-Vision-Instruct",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the ingredients and nutritional information from this image." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const extractedContent = visionResponse.data.choices[0].message.content;
    console.log(extractedContent)
    res.json({ extractedContent });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error analyzing image");
  }
});

// New endpoint to handle user questions
router.post("/askQuestion", async (req, res) => {
  const { question, extractedContent } = req.body;

  try {
    const response = await axios.post(
      "https://api.sambanova.ai/v1/chat/completions",
      {
        model: "Meta-Llama-3.3-70B-Instruct",
        messages: [
          { 
            role: "system", 
            content: "You are a helpful assistant knowledgeable about food ingredients and nutrition. Provide concise and to-the-point answers to user questions."
          },
          { 
            role: "user", 
            content: `Based on the following information, answer the user's question:\n\n**Extracted Content**: ${extractedContent}\n\nUser's Question: ${question}\n\nPlease provide a short and simple response, avoiding unnecessary details or explanations.`
          },
        ],
        
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const answer = response.data.choices[0].message.content;
    res.json({ answer });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error processing your question");
  }
});



// Endpoint for chatbot interactions using Meta-Llama-3.3-70B-Instruct
router.post("/chat", async (req, res) => {
  try {
//console.log(req.body);
//console.log(req.headers);
    const extractedIngredients = req.body.ingredients;  // Get the extracted content (ingredients, etc.)
    
//console.log(extractedIngredients);
    // Create the prompt for recipe generation
    const prompt = `You are an AI recipe generator. Given the following list of ingredients, generate 1 recipe. The recipe should be structured in the following JSON format:

{
  "recipes": [
    {
      "title": "{Recipe Name}",
      "ingredients": [
        "{Ingredient 1}",
        "{Ingredient 2}",
        "{Ingredient 3}"
      ],
      "instructions": "{Instructions to cook the dish}"
    }
  ]
}

**Ingredients Provided**: ${extractedIngredients}

Ensure each recipe includes:
1. A descriptive title for the recipe.
2. A list of ingredients relevant to the provided ingredients.
3. small cooking instructions.

Respond only with the Proper JSON structure.`;

    // Step 4: Pass the extracted content and the user's question to the text model
    const response = await axios.post(
      "https://api.sambanova.ai/v1/chat/completions",
      {
        stream: true,
        model: "Meta-Llama-3.3-70B-Instruct",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: prompt },
        ],
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    //console.log( response.data);

    const lines = response.data.split('\n');

const dataLines = lines.filter(line => line.startsWith('data:'));

const jsonData = dataLines.map(line => {
  const cleanLine = line.replace(/^data:\s*/, '');
  return cleanLine !== '[DONE]' ? JSON.parse(cleanLine) : null;
}).filter(entry => entry !== null);
let accumulatedDelta = '';

jsonData.forEach(chunk => {
  if (chunk.choices[0].delta.content) {
    accumulatedDelta += chunk.choices[0].delta.content;
  }
});

console.log(accumulatedDelta); 
res.json({ accumulatedDelta });


  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error in chatbot response");
  }
});

module.exports = router;
