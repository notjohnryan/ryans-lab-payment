const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// Health check for Railway
app.get('/', (req, res) => res.status(200).send("SERVER IS ALIVE"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 1. THE PAY ROUTE
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
            line_items: [{ 
              amount: price, 
              currency: 'PHP', 
              name: "Token Pack", 
              description: `Top-up of ${totalTokens.toLocaleString()} tokens`,
              quantity: qty 
            }],
            payment_method_types: ['qrph'],
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

// 2. THE WEBHOOK (Email -> ID -> Balance)
app.post('/webhook', async (req, res) => {
  const body = req.body;
  const resource = body.data?.attributes?.data || body.data; 
  const metadata = resource?.attributes?.metadata || resource?.metadata;

  if (body.data?.type === 'checkout_session.payment.paid' || body.data?.type === 'payment.paid') {
    const userEmail = metadata?.email;
    const amount = parseInt(metadata?.token_credits);

    if (!userEmail) return res.status(200).send('OK');

    const client = new MongoClient(process.env.MONGO_URI);
    try {
      await client.connect();
      const db = client.db("test");

      // Find the user's REAL ID from the users collection
      const userDoc = await db.collection('users').findOne({ email: userEmail });
      if (!userDoc) {
        console.error(`❌ User not found: ${userEmail}`);
        return res.status(200).send('OK');
      }

      const realId = userDoc._id; // This is the ObjectId

      // Update the balances collection
      const updateResult = await db.collection('balances').updateOne(
        { $or: [{ _id: realId }, { user: realId }] },
        { 
          $inc: { "tokenCredits": amount },
          $set: { "last_topup": new Date(), "updatedAt": new Date() }
        }
      );

      if (updateResult.modifiedCount > 0) {
        console.log(`✅ SUCCESS: Tokens added to ${userEmail}`);
      } else {
        // Create balance record if it doesn't exist
        await db.collection('balances').insertOne({
          user: realId,
          tokenCredits: amount,
          updatedAt: new Date()
        });
        console.log(`✅ SUCCESS: Created new balance for ${userEmail}`);
      }
    } catch (err) {
      console.error("❌ DB ERROR:", err.message);
    } finally {
      await client.close();
      return res.status(200).send('OK');
    }
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server on ${PORT}`));
