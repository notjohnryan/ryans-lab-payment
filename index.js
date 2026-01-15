const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check - Keeps Railway "Green"
app.get('/', (req, res) => {
  res.status(200).send("SERVER IS ALIVE");
});

// 2. Pricing Logic (PHP in cents: 25000 = 250.00 PHP)
const PRICING = { 1: 25000, 2: 22500, 3: 20000, 4: 18000 };
const TOKEN_PACK_SIZE = 5000000;

// 3. PAYMENT TRIGGER (Redirects to PayMongo)
app.get('/pay', async (req, res) => {
  try {
    const { userId, quantity } = req.query;
    if (!userId) return res.status(400).send("Missing userId");

    const qty = parseInt(quantity) || 1;
    const price = PRICING[qty] || 25000;
    const totalTokens = qty * TOKEN_PACK_SIZE;

    // LOG: Shows in Railway when user clicks "Top Up"
    console.log(`🛒 CHECKOUT INITIATED: User [${userId}] | Qty [${qty}] | Tokens [${totalTokens.toLocaleString()}]`);

    const options = {
      method: 'POST',
      url: 'https://api.paymongo.com/v1/checkout_sessions',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`
      },
      data: {
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            description: `Top-up for ${totalTokens.toLocaleString()} tokens`,
            line_items: [{ 
              amount: price, 
              currency: 'PHP', 
              name: "Ryan's Lab: Token Pack", 
              quantity: qty 
            }],
            payment_method_types: ['qrph', 'gcash', 'card', 'paymaya'],
            success_url: process.env.SUCCESS_URL,
            cancel_url: process.env.SUCCESS_URL,
            metadata: { 
              userId: userId, 
              token_credits: totalTokens.toString() 
            }
          }
        }
      }
    };

    const response = await axios.request(options);
    console.log(`🔗 PayMongo Link Created for ${userId}. Redirecting...`);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("❌ PayMongo Error:", error.response ? error.response.data : error.message);
    res.status(500).send("Payment System Error.");
  }
});

// 4. AUTOMATION WEBHOOK (Credits tokens to DB)
app.post('/webhook', async (req, res) => {
  // Respond OK to PayMongo immediately
  res.status(200).send('OK');

  const data = req.body.data;
  if (data && data.type === 'checkout_session.payment.paid') {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
      const attributes = data.attributes || {};
      const payload = attributes.payload || attributes;
      const metadata = payload.metadata;
      
      const userId = metadata.userId;
      const creditsToAdd = parseInt(metadata.token_credits);

      console.log(`💰 Webhook Received: Crediting ${creditsToAdd} tokens to User ${userId}`);

      await client.connect();
      const db = client.db("test"); // Using the verified DB name
      const collection = db.collection('users'); // Using the verified collection name

      // Safety: Handle both ObjectId and String ID formats
      const query = { 
        _id: userId.length === 24 ? new ObjectId(userId) : userId 
      };

      const result = await collection.updateOne(
        query, 
        { 
          $inc: { "balances.tokenCredits": creditsToAdd },
          $set: { "balances.last_topup": new Date() }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`✅ DATABASE UPDATED: +${creditsToAdd.toLocaleString()} for ${userId}`);
      } else {
        console.error(`❌ DB FAIL: User ${userId} not found in test.users collection.`);
      }
    } catch (err) {
      console.error("🔥 Webhook/DB Error:", err.message);
    } finally {
      await client.close();
    }
  }
});

// 5. START SERVER
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EXECUTED: Server listening on ${PORT}`);
});

// Safety Catch for Railway SIGTERM
process.on('SIGTERM', () => {
  console.log('⚠️ SYSTEM: Received SIGTERM. Shutting down gracefully.');
});
