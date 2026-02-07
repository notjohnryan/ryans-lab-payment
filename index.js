const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

app.get('/', (req, res) => res.status(200).send("RYANS LAB WEBHOOK ACTIVE"));

// --- PAY ROUTE ---
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    const cleanEmail = email ? email.toString().trim().toLowerCase() : "";
    const qty = parseInt(quantity) || 1;
    const totalTokens = qty * 5000000;
    const totalPrice = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 }[qty] || 25000;

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
            billing: { email: cleanEmail },
            line_items: [{ 
              amount: Math.floor(totalPrice / qty), 
              currency: 'PHP', 
              name: `Ryan's Lab: ${totalTokens / 1000000}M Tokens`, 
              quantity: qty,
              images: ["https://ryanslab.space/logo.png"] 
            }],
            payment_method_types: ['qrph'],
            success_url: process.env.SUCCESS_URL,
            metadata: { 
              email: cleanEmail, 
              token_credits: totalTokens.toString() 
            } 
          }
        }
      }
    };
    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);
  } catch (error) {
    res.status(500).send("Error");
  }
});

// --- UNIVERSAL WEBHOOK ---
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  let client;
  try {
    const body = req.body;
    
    // 🛡️ UNIVERSAL DATA EXTRACTOR
    // This looks for the email in both the manual CURL format and the REAL PayMongo format
    const metadata = 
      body.data?.attributes?.data?.attributes?.metadata || // Your manual CURL format
      body.data?.attributes?.metadata ||                  // Real PayMongo format
      body.data?.metadata;                                 // Backup format

    if (!metadata || !metadata.email) {
      console.log("⚠️ Could not find email in webhook payload. Payload structure:", JSON.stringify(body).substring(0, 200));
      return;
    }

    const userEmail = metadata.email.trim().toLowerCase();
    const tokensToAdd = Number(metadata.token_credits) || 0;

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    console.log(`🔍 Processing: ${userEmail} | Adding: ${tokensToAdd}`);

    // 1. Find User
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found in database.`);
      return;
    }

    const userId = userDoc._id;
    const now = new Date();

    // 2. Update Both Collections & All Fields
    await db.collection('users').updateOne(
      { _id: userId },
      { $inc: { "tokenCredits": tokensToAdd }, $set: { "last_topup": now, "updatedAt": now } }
    );

    const balanceUpdate = await db.collection('balances').updateOne(
      { $or: [{ user: userId.toString() }, { user: userId }] },
      { 
        $inc: { "tokenCredits": tokensToAdd, "balances.tokenCredits": tokensToAdd },
        $set: { "last_topup": now, "balances.last_topup": now, "updatedAt": now }
      }
    );

    if (balanceUpdate.modifiedCount > 0) {
      console.log(`🎉 SUCCESS: Added ${tokensToAdd} tokens to ${userEmail}`);
    } else {
      console.log(`⚠️ User found but balance record missing. Created record instead.`);
      await db.collection('balances').insertOne({
         user: userId.toString(),
         tokenCredits: tokensToAdd,
         updatedAt: now
      });
    }

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 READY`));
