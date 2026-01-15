const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// Variables from Railway
const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY;
const SUCCESS_URL = process.env.SUCCESS_URL; 
const MONGO_URI = process.env.MONGO_URI; 

// Pricing Logic with Volume Discounts
const PRICING = {
  tokenPackSize: 5000000, 
  basePrice: 25000, // PHP 250.00 in cents
  volumeDiscounts: {
    1: 25000, 2: 22500, 3: 20000, 4: 18000
  }
};

// 1. Health Check (Crucial for Railway to see the app is alive)
app.get('/', (req, res) => {
  res.status(200).send("🚀 Ryan's Lab Payment Server is LIVE on Port 3001.");
});

// 2. PAYMENT TRIGGER (Redirects user to PayMongo)
app.get('/pay', async (req, res) => {
  try {
    const userId = req.query.userId;
    let quantity = parseInt(req.query.quantity) || 1;
    
    if (!userId) return res.status(400).send("User ID is required.");

    const pricePerPack = PRICING.volumeDiscounts[quantity] || PRICING.basePrice;
    const totalTokens = quantity * PRICING.tokenPackSize;
    
    console.log(`🛒 CHECKOUT STARTED: User [${userId}] | Quantity [${quantity}] | Tokens [${totalTokens.toLocaleString()}]`);

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
    console.log(`🔗 PayMongo Session Created. Redirecting ${userId}...`);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("❌ PayMongo Error:", error.response ? error.response.data : error.message);
    res.status(500).send("Payment System Error.");
  }
});

// 3. AUTOMATION WEBHOOK (Updates the Database)
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK'); 
  
  const data = req.body.data;
  if (data && data.type === 'checkout_session.payment.paid') {
    const client = new MongoClient(MONGO_URI);
    try {
      const attributes = data.attributes || {};
      const payload = attributes.payload || attributes;
      const metadata = payload.metadata;
      
      const userId = metadata.userId;
      const creditsToAdd = parseInt(metadata.token_credits);

      console.log(`💰 Webhook: UserID [${userId}] | Credits [${creditsToAdd}]`);

      await client.connect();
      const db = client.db("test"); 
      const collection = db.collection('users');

      // Diagnostic search to handle ObjectId vs String formats
      const findById = await collection.findOne({ _id: new ObjectId(userId) });
      const findByString = await collection.findOne({ _id: userId });

      const query = findById ? { _id: new ObjectId(userId) } : { _id: userId };

      const result = await collection.updateOne(
        query, 
        { 
          $inc: { "balances.tokenCredits": creditsToAdd },
          $set: { "balances.last_topup": new Date() }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ SUCCESS: Credited ${creditsToAdd.toLocaleString()} tokens to ${userId}`);
      } else {
        console.error(`❌ DB FAIL: User ${userId} found? ${!!(findById || findByString)}`);
      }
    } catch (err) {
      console.error("🔥 DB Error:", err.message);
    } finally {
      await client.close();
    }
  }
});

// 4. BIND TO PORT 3001
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Ryan's Lab Payment Server actively listening on port ${PORT}`);
});
