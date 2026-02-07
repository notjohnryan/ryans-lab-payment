const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => res.status(200).send("RYANS LAB FINAL SYNC SERVER"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE (QRPH ONLY)
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    const cleanEmail = email ? email.toString().trim().toLowerCase() : "";
    const qty = parseInt(quantity) || 1;
    const totalTokens = qty * 5000000;
    const totalPrice = PRICING[qty] || 25000;

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
            payment_method_types: ['qrph'], // Strictly QRPH
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
    console.error("🔥 Pay Route Error:", error.message);
    res.status(500).send("Error generating checkout link");
  }
});

// 3. THE UNIVERSAL WEBHOOK (DEEP DRILL)
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  let client;
  try {
    const body = req.body;
    
    // 🛡️ EXTRACTION LOGIC (Based on your Live Log)
    // Live QRPH payments store metadata inside the first element of the 'payments' array.
    const payments = body.data?.attributes?.data?.attributes?.payments;
    let metadata = null;

    if (payments && payments.length > 0) {
      metadata = payments[0].attributes?.metadata;
      console.log("📍 Metadata located in Payments Array (Live Mode)");
    } else {
      // Fallback for Manual CURL tests or standard sessions
      metadata = body.data?.attributes?.data?.attributes?.metadata || 
                 body.data?.attributes?.metadata;
      console.log("📍 Metadata located in Session Attributes");
    }

    if (!metadata || !metadata.email) {
      console.log("⚠️ Webhook received but metadata/email missing from payload.");
      return;
    }

    const userEmail = metadata.email.trim().toLowerCase();
    const tokensToAdd = Number(metadata.token_credits) || 0;

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    console.log(`🔍 Processing: ${userEmail} | Credits: ${tokensToAdd}`);

    // --- STEP A: SYNC 'users' FOLDER ---
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found in users collection.`);
      return;
    }

    const userId = userDoc._id; // This is the linking ID (695a9ee5...)
    const now = new Date();

    // Update tokenCredits directly on User
    await db.collection('users').updateOne(
      { _id: userId },
      { 
        $inc: { "tokenCredits": tokensToAdd }, 
        $set: { "last_topup": now, "updatedAt": now } 
      }
    );

    // --- STEP B: SYNC 'balances' FOLDER ---
    // Targets the document where the 'user' field matches (even if 'Mixed' type)
    // Updates both the root tokenCredits and the nested balances.tokenCredits found in your JSON
    const balanceUpdate = await db.collection('balances').updateOne(
      { 
        $or: [
          { user: userId.toString() }, 
          { user: userId }
        ] 
      },
      { 
        $inc: { 
          "tokenCredits": tokensToAdd, 
          "balances.tokenCredits": tokensToAdd 
        },
        $set: { 
          "last_topup": now,
          "balances.last_topup": now,
          "updatedAt": now 
        }
      }
    );

    if (balanceUpdate.modifiedCount > 0) {
      console.log(`🎉 SUCCESS: Synced all folders for ${userEmail}`);
    } else {
      console.log(`⚠️ Balance record match failed. Creating new entry for user: ${userId}`);
      await db.collection('balances').insertOne({
        user: userId.toString(),
        tokenCredits: tokensToAdd,
        balances: { tokenCredits: tokensToAdd, last_topup: now },
        last_topup: now,
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
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 READY ON PORT ${PORT}`));
