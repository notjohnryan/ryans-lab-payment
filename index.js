const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// Variables from Railway
const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY;
const SUCCESS_URL = process.env.SUCCESS_URL; 
const MONGO_URI = process.env.MONGO_URI; 

// Your Pricing Logic
const PRICING = {
  tokenPackSize: 5000000, 
  basePrice: 25000, // 250.00 PHP in cents
  volumeDiscounts: {
    1: 25000, 2: 22500, 3: 20000, 4: 18000
  }
};

// 1. HEALTH CHECK
app.get('/', (req, res) => {
  res.send("🚀 Ryan's Lab Payment Server is LIVE.");
});

// 2. PAYMENT TRIGGER (Matches your old /pay path)
app.get('/pay', async (req, res) => {
  try {
    const userId = req.query.userId;
    let quantity = parseInt(req.query.quantity) || 1;
    
    if (!userId) return res.status(400).send("User ID is required.");

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
              name: "Ryan's Lab: Token Pack",
              quantity: quantity
            }],
            metadata: {
              userId: userId,
              token_credits: totalTokens.toString()
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

// 3. AUTOMATION WEBHOOK (With Database Fixes)
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK'); // Always acknowledge first
  
  const data = req.body.data;
  if (data.type === 'checkout_session.payment.paid') {
    const metadata = data.attributes.payload.metadata;
    const userId = metadata.userId;
    const creditsToAdd = parseInt(metadata.token_credits);

    console.log(`💰 Payment Success! Adding ${creditsToAdd} tokens to User: ${userId}`);

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      // Target the 'test' database and 'users' collection
      const db = client.db('test'); 
      const users = db.collection('users');

      // FIXED PATH: updates "balances.tokenCredits"
      const result = await users.updateOne(
        { _id: new ObjectId(userId) }, 
        { 
          $inc: { "balances.tokenCredits": creditsToAdd },
          $set: { "balances.last_topup": new Date() }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ Database Updated: +${creditsToAdd} for ${userId}`);
      } else {
        console.log(`❌ FAIL: User ${userId} found, but path 'balances.tokenCredits' failed.`);
      }
    } catch (err) {
      console.error("❌ Automation Database Error:", err);
    } finally {
      await client.close();
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
