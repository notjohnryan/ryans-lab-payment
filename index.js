const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// Health check to verify the domain is working
app.get('/', (req, res) => res.status(200).send("Payment Server is Online"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE
app.get('/pay', async (req, res) => {
  try {
    const { email, quantity } = req.query; 
    if (!email) return res.status(400).send("Email required");

    const qty = parseInt(quantity) || 1;
    const amountInCents = PRICING[qty] || 25000;
    const totalTokens = (qty * 5000000).toString();

    console.log(`🛒 Creating Session: ${email} for ₱${amountInCents/100}`);

    const options = {
      method: 'POST',
      url: 'https://api.paymongo.com/v1/checkout_sessions',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        // Make sure this matches your Railway Variable name exactly
        authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`
      },
      data: {
        data: {
          attributes: {
            send_email_receipt: true,
            payment_method_types: ['qrph', 'gcash', 'maya'],
            line_items: [{
              amount: amountInCents, 
              currency: 'PHP',
              name: "Token Top-up",
              quantity: 1 
            }],
            // Use your custom domain for the success redirect
            success_url: "https://ryanslab.space", 
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
    if (error.response) {
      console.error("🔥 PayMongo Detail:", JSON.stringify(error.response.data));
    } else {
      console.error("🔥 Error:", error.message);
    }
    res.status(500).send("Checkout Error - Check Railway Logs");
  }
});

// 3. THE WEBHOOK
app.post('/webhook', async (req, res) => {
  console.log("⚡ Webhook Received");
  res.status(200).send('OK');

  let client;
  try {
    const body = req.body;
    const resource = body.data?.attributes?.data || body.data; 
    const metadata = resource?.attributes?.metadata || resource?.metadata;

    if (!metadata || !metadata.email) return;

    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db("test");

    const userDoc = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${metadata.email.trim()}$`, 'i') } 
    });

    if (userDoc) {
      const targetId = new ObjectId(userDoc._id);
      await db.collection('balances').updateOne(
        { $or: [{ _id: targetId }, { user: targetId }] },
        { 
          $inc: { "tokenCredits": parseInt(metadata.token_credits) },
          $set: { "updatedAt": new Date() }
        },
        { upsert: true }
      );
      console.log(`🎉 Success: Credited ${metadata.email}`);
    }
  } catch (err) {
    console.error("🔥 Webhook Error:", err.message);
  } finally {
    if (client) await client.close();
  }
});

// Match the port Railway is expecting
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on port ${PORT}`));
