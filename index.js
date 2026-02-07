const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => {
  res.status(200).send("RYANS LAB PAYMENT SERVER ONLINE");
});

// Pricing in Cents (PHP)
const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE (Session Creation)
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    
    if (!email) {
      console.log("⚠️ Checkout attempted without email");
      return res.status(400).send("Email is required");
    }

    const qty = parseInt(quantity) || 1;
    const totalAmount = PRICING[qty] || 25000;
    const totalTokens = (qty * 5000000).toString(); // Must be a string for metadata

    console.log(`🛒 Creating Session: ${email} | Qty: ${qty} | Tokens: ${totalTokens}`);

    // Ensure Success URL is valid
    let successUrl = process.env.SUCCESS_URL || "https://ryanslab.space";
    if (!successUrl.startsWith('http')) successUrl = `https://${successUrl}`;

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
            payment_method_types: ['qrph', 'gcash', 'maya'],
            line_items: [{ 
              amount: totalAmount,
              currency: 'PHP', 
              name: `Ryan's Lab: ${qty * 5}M Tokens`, 
              quantity: 1 // Bundle treated as 1 unit
            }],
            success_url: successUrl,
            billing: { email: email.toString() },
            metadata: { 
              email: email.toString(), 
              token_credits: totalTokens 
            } 
          }
        }
      }
    };

    const response = await axios.request(options);
    res.redirect(response.data.data.attributes.checkout_url);

  } catch (error) {
    // Detailed error logging for Railway
    if (error.response) {
      console.error("🔥 PAYMONGO REJECTION:", JSON.stringify(error.response.data.errors));
    } else {
      console.error("🔥 SERVER ERROR:", error.message);
    }
    res.status(500).send("Error generating checkout link. Check server logs.");
  }
});

// 3. THE WEBHOOK (Database Update)
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received");
  res.status(200).send('OK');

  let client;
  try {
    const body = req.body;
    // Extracting nested data from PayMongo webhook structure
    const resource = body.data?.attributes?.data || body.data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) {
      console.log("⚠️ Webhook missing metadata");
      return;
    }

    const userEmail = metadata.email.trim();
    const amountToAdd = parseInt(metadata.token_credits);

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    // STEP A: Lookup the user in the 'users' collection
    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${userEmail}$`, 'i') } 
    });

    if (!userDoc) {
      console.log(`❌ User ${userEmail} not found in database.`);
      return;
    }

    // STEP B: Update 'balances' folder with Strict ObjectId
    const targetId = new ObjectId(userDoc._id);
    console.log(`✅ Matching Balance for User ID: ${targetId}`);

    const updateResult = await db.collection('balances').updateOne(
      { 
        $or: [
          { _id: targetId }, // Check if ID is the balance key
          { user: targetId }  // Check if user field is the balance key
        ] 
      },
      { 
        $inc: { "tokenCredits": amountToAdd },
        $set: { 
          "last_topup": new Date(), 
          "updatedAt": new Date() 
        }
      },
      { upsert: true } // Create if doesn't exist
    );

    console.log(`🎉 SUCCESS: Added ${amountToAdd} tokens to ID: ${targetId}`);

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  } finally {
    if (client) await client.close();
  }
});

// 4. Server Start
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 PAYMENT SERVER RUNNING ON PORT ${PORT}`);
});
