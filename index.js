const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb'); // Added MongoDB support
const app = express();

app.use(express.json());

const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY;
const SUCCESS_URL = process.env.SUCCESS_URL; 
const MONGO_URI = process.env.MONGO_URI; // Add this variable in Railway!

const PRICING = {
  tokenPackSize: 5000000, 
  basePrice: 25000,        
  volumeDiscounts: {
    1: 25000, 2: 22500, 3: 20000, 4: 18000
  }
};

// 1. PAYMENT TRIGGER
app.get('/pay', async (req, res) => {
  try {
    // Dynamic User ID from URL
    const userId = req.query.userId || 'guest'; 
    let quantity = parseInt(req.query.quantity) || 1;
    
    const pricePerPack = PRICING.volumeDiscounts[quantity] || PRICING.basePrice;
    const totalTokens = quantity * PRICING.tokenPackSize;
    
    const options = {
      method: 'POST',
      url: 'https://api.paymongo.com/v1/checkout_sessions',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        authorization: `Basic ${Buffer.from(PAYMONGO_SECRET + ':').toString('base64')}`
      },
      data: {
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            description: `Top-up for ${totalTokens.toLocaleString()} tokens for Ryan's Lab.`,
            line_items: [{
              amount: pricePerPack,
              currency: 'PHP',
              name: "Ryan's Lab: 5M Tokens",
              quantity: quantity
            }],
            metadata: {
              userId: userId, // Match key used in Balance.tsx
              token_credits: totalTokens
            },
            payment_method_types: ['qrph', 'card', 'gcash', 'paymaya'],
            success_url: SUCCESS_URL,
            cancel_url: SUCCESS_URL
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("PayMongo Error:", error.response ? error.response.data : error);
    res.status(500).send("Payment System Error.");
  }
});

// 2. AUTOMATION WEBHOOK (THE MAGIC)
app.post('/webhook', async (req, res) => {
  const data = req.body.data;
  
  if (data.type === 'checkout_session.payment.paid') {
    const metadata = data.attributes.payload.metadata;
    const userId = metadata.userId;
    const creditsToAdd = parseInt(metadata.token_credits);

    console.log(`💰 Payment Success! Adding ${creditsToAdd} tokens to User: ${userId}`);

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const db = client.db(); 
      const users = db.collection('users');

      // Update the user's balance automatically
      await users.updateOne(
        { _id: new ObjectId(userId) }, 
        { $inc: { balance: creditsToAdd } }
      );

      console.log(`✅ Database Updated: +${creditsToAdd} for ${userId}`);
    } catch (err) {
      console.error("❌ Automation Database Error:", err);
    } finally {
      await client.close();
    }
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Automation server running on port ${PORT}`));
