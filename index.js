const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/', (req, res) => res.status(200).send("SERVER IS ALIVE"));

const PRICING = { 1: 25000, 2: 45000, 3: 60000, 4: 72000, 5: 85000 };

// 2. THE PAY ROUTE (Initiates Checkout)
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
            send_email_receipt: true, // Sends receipt via PayMongo
            show_description: true,
            billing: { email: email },
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

// 3. THE WEBHOOK (Processes Payment)
app.post('/webhook', async (req, res) => {
  console.log("⚡ Webhook Received");
  const body = req.body;
  
  // Extracting metadata from PayMongo's nested structure
  const resource = body.data?.attributes?.data || body.data; 
  const metadata = resource?.attributes?.metadata || resource?.metadata;

  if (body.data?.type === 'checkout_session.payment.paid' || body.data?.type === 'payment.paid') {
    const userEmail = metadata?.email;
    const amount = parseInt(metadata?.token_credits);

    if (!userEmail) {
      console.error("❌ No email
