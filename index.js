const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY;
const SUCCESS_URL = process.env.SUCCESS_URL; 
const MONGO_URI = process.env.MONGO_URI; 

const PRICING = {
  tokenPackSize: 5000000, 
  basePrice: 25000, 
  volumeDiscounts: {
    1: 25000, 2: 22500, 3: 20000, 4: 18000
  }
};

app.get('/', (req, res) => {
  res.send("🚀 Ryan's Lab Payment Server is LIVE.");
});

// 1. PAYMENT TRIGGER (With Added Logs)
app.get('/pay', async (req, res) => {
  try {
    const userId = req.query.userId;
    let quantity = parseInt(req.query.quantity) || 1;
    
    if (!userId) return res.status(400).send("User ID is required.");

    const pricePerPack = PRICING.volumeDiscounts[quantity] || PRICING.basePrice;
    const totalTokens = quantity * PRICING.tokenPackSize;
    
    // NEW LOG: This will show in Railway as soon as the user clicks "Top Up"
    console.log(`🛒 CHECKOUT STARTED: User [${userId}] | Quantity [${quantity}] | Total Tokens [${totalTokens.toLocaleString()}]`);

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
    
    // NEW LOG: Confirms PayMongo is ready
    console.log(`🔗 PayMongo Session Created for ${userId}. Redirecting...`);
    
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("PayMongo Error:", error.response ? error.response.data : error);
    res.status(500).send("Payment System Error.");
  }
});

// 2. AUTOMATION WEBHOOK
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK'); 
  
  const data = req.body.data;
  if (data.type === 'checkout_session.payment.paid') {
    const attributes = data.attributes || {};
    const payload = attributes.payload || attributes;
    const metadata = payload.metadata;
    
    const userId = metadata?.userId;
    const creditsToAdd = parseInt(metadata?.token_credits);

    if (!userId || isNaN(creditsToAdd)) {
        console.log("⚠️ Webhook received but metadata is invalid.");
        return;
    }

    console.log(`💰 PAYMENT SUCCESS: Adding ${creditsToAdd.toLocaleString()} tokens to User: ${userId}`);

    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const db = client.db('test'); 
      const users = db.collection('users');

      const result = await users.updateOne(
        { _id: new ObjectId(userId) }, 
        { 
          $inc: { "balances.tokenCredits": creditsToAdd },
          $set: { "balances.last_topup": new Date() }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ DB UPDATED: +${creditsToAdd.toLocaleString()} for ${userId}`);
      } else {
        console.log(`❌ DB FAIL: User ${userId} found, but no changes made.`);
      }
    } catch (err) {
      console.error("❌ DB ERROR:", err);
    } finally {
      await client.close();
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
