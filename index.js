const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check & Keep-Alive
app.get('/', (req, res) => {
  console.log("💓 Health check ping received");
  res.status(200).send("SERVER IS ALIVE");
});

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    const qty = parseInt(quantity) || 1;
    const totalPrice = PRICING[qty] || 25000;
    
    // MATH FIX: Calculate price per unit so PayMongo displays it correctly
    const unitPrice = Math.floor(totalPrice / qty); 
    
    const totalTokens = qty * 5000000;
    const tokenDisplay = `${totalTokens / 1000000}M`;

    console.log(`🛒 Creating Session: ${email} | Qty: ${qty} | Unit Price: ${unitPrice/100}`);

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
            billing: { email: email },
            line_items: [{ 
              amount: unitPrice, // Now 22500 for the 2-pack
              currency: 'PHP', 
              name: `Ryan's Lab: ${tokenDisplay} Tokens`, 
              description: `Bundle of ${qty} Token Packs`,
              quantity: qty // Now shows "2" on the checkout screen
            }],
            payment_method_types: ['qrph', 'gcash', 'card'],
            success_url: process.env.SUCCESS_URL,
            metadata: { email: email, token_credits: totalTokens.toString() } 
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    console.error("Pay Route Error:", error.message);
    res.status(500).send("Error generating checkout link");
  }
});

// 3. THE WEBHOOK
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  try {
    const body = req.body;
    const resource = body.data?.attributes?.data || body.data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) return;

    const userEmail = metadata.email;
    const amount = parseInt(metadata.token_credits);

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    const userDoc = await db.collection('users').findOne({ email: userEmail });
    if (!userDoc) {
      await client.close();
      return;
    }

    const realId = userDoc._id;
    await db.collection('balances').updateOne(
      { $or: [{ _id: realId }, { user: realId }, { _id: realId.toString() }, { user: realId.toString() }] },
      { 
        $inc: { "tokenCredits": amount },
        $set: { "last_topup": new Date(), "updatedAt": new Date() }
      },
      { upsert: true }
    );

    await client.close();
    console.log(`🎉 SUCCESS: Added ${amount} to ${userEmail}`);
  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER ONLINE ON PORT ${PORT}`);
});
