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
    const price = PRICING[qty] || 25000;
    const totalTokens = qty * 5000000;

    console.log(`🛒 Creating Session: ${email} | Qty: ${qty}`);

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
            show_description: true,
            line_items: [{ 
              amount: price, 
              currency: 'PHP', 
              name: "Token Pack", 
              description: `Top-up of ${totalTokens.toLocaleString()} tokens`,
              quantity: qty 
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

// 3. THE WEBHOOK (Metadata Hunter)
app.post('/webhook', async (req, res) => {
  console.log("⚡ [WEBHOOK] Signal received from PayMongo");
  
  try {
    const body = req.body;
    
    // Extract metadata from nested structure
    const resource = body.data?.attributes?.data || body.data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) {
      console.log("⚠️ Webhook received but no email found in metadata. Full body check...");
      return res.status(200).send('OK');
    }

    const userEmail = metadata.email;
    const amount = parseInt(metadata.token_credits);

    console.log(`🎯 TARGET: ${userEmail} | ADDING: ${amount} tokens`);

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    // FIND THE USER _ID
    const userDoc = await db.collection('users').findOne({ email: userEmail });

    if (!userDoc) {
      console.error(`❌ FAILED: User ${userEmail} not found in database.`);
      await client.close();
      return res.status(200).send('OK');
    }

    const realId = userDoc._id;

    // UPDATE BALANCES (Safety checks for Object and String IDs)
    const updateResult = await db.collection('balances').updateOne(
      { $or: [{ _id: realId }, { user: realId }, { _id: realId.toString() }, { user: realId.toString() }] },
      { 
        $inc: { "tokenCredits": amount },
        $set: { "last_topup": new Date(), "updatedAt": new Date() }
      }
    );

    if (updateResult.modifiedCount > 0) {
      console.log(`🎉 SUCCESS: Tokens added to ${userEmail}`);
    } else {
      console.log("🆕 CREATING: New record created for user.");
      await db.collection('balances').insertOne({
        user: realId,
        tokenCredits: amount,
        updatedAt: new Date()
      });
    }

    await client.close();
  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
  }
  
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER ONLINE ON PORT ${PORT}`);
});
