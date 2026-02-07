const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => res.status(200).send("PAYMENT SERVER ONLINE"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE (With Branding)
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    const qty = parseInt(quantity) || 1;
    const totalPrice = PRICING[qty] || 25000;
    const unitPrice = Math.floor(totalPrice / qty); 
    const totalTokens = qty * 5000000;

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
              amount: unitPrice,
              currency: 'PHP', 
              name: `Ryan's Lab: ${totalTokens / 1000000}M Tokens`, 
              quantity: qty,
              images: ["https://ryanslab.space/logo.png"] // Branding added
            }],
            payment_method_types: ['qrph'],
            success_url: process.env.SUCCESS_URL,
            metadata: { 
              email: email, 
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

// 3. THE WEBHOOK (Fixed for your 'Mixed' DB Structure)
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  let client;
  try {
    const { data } = req.body;
    const resource = data?.attributes?.data || data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) return;

    const userEmail = metadata.email.trim();
    const tokensToAdd = Number(metadata.token_credits); // Ensure it's a Number

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    // STEP A: Get the User's _id from 'users'
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found.`);
      return;
    }

    const userId = userDoc._id; // This is 695a9ee531b028706a9633f7
    console.log(`✅ Found User ID: ${userId}. Updating 'balances'...`);

    /**
     * STEP B: UPDATE BALANCES
     * We target the 'user' field as the link.
     * We update 'tokenCredits' as a Number.
     */
    const updateResult = await db.collection('balances').updateOne(
      { 
        $or: [
          { user: userId }, 
          { user: userId.toString() }
        ] 
      },
      { 
        $inc: { "tokenCredits": tokensToAdd },
        $set: { 
          "updatedAt": new Date(),
          "last_topup": new Date()
        }
      },
      { upsert: true } 
    );

    if (updateResult.modifiedCount > 0 || updateResult.upsertedCount > 0) {
      console.log(`🎉 SUCCESS: Credited ${tokensToAdd} to ${userEmail}`);
    }

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ONLINE ON PORT ${PORT}`));
