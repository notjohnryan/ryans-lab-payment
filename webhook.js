const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

// MongoDB connection URI (from Railway)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ryanslab';

// PayMongo webhook secret (get from PayMongo dashboard later)
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || 'temp_secret';

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1); // Exit if DB connection fails
});

// User model (matches your Ryan's Lab DB structure)
const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Using string ID (from auth)
  email: { type: String, unique: true },
  tokenCredits: { type: Number, default: 0 },
  lastTopUp: Date,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Webhook validation middleware
const validateWebhook = (req, res, next) => {
  const signature = req.headers['paymongo-signature'];
  if (!signature) {
    console.error('❌ Missing signature header');
    return res.status(400).send('Missing signature header');
  }
  
  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', PAYMONGO_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    console.error('❌ Invalid signature:', signature);
    return res.status(401).send('Invalid signature');
  }
  
  console.log('✅ Valid webhook signature');
  next();
};

// Handle payment success events
app.post('/webhook', validateWebhook, async (req, res) => {
  try {
    const event = req.body;
    
    // Log the entire event for debugging (remove in production)
    console.log('📥 Received webhook:', JSON.stringify({
      id: event.data.id,
      type: event.data.attributes.type,
      status: event.data.attributes.data.attributes.payment_intent.attributes.status
    }, null, 2));
    
    // Only process successful checkout sessions
    const isCheckoutSession = event.data.attributes.type === 'checkout.session';
    const isPaymentSucceeded = event.data.attributes.data.attributes.payment_intent.attributes.status === 'succeeded';
    
    if (isCheckoutSession && isPaymentSucceeded) {
      const metadata = event.data.attributes.data.attributes.metadata;
      
      // Critical info from PayMongo
      const userId = metadata.user_id;
      const tokenCredits = parseInt(metadata.token_credits);
      
      console.log(`🏦 Processing payment for user: ${userId}`);
      console.log(`💰 Adding ${tokenCredits.toLocaleString()} tokens`);
      
      // Update user's token balance
      const user = await User.findOneAndUpdate(
        { _id: userId },
        { 
          $inc: { tokenCredits: tokenCredits },
          $set: { lastTopUp: new Date() }
        },
        { new: true, upsert: false } // Don't create if user doesn't exist
      );
      
      if (!user) {
        console.error(`❌ User not found: ${userId}`);
        return res.status(404).send('User not found');
      }
      
      console.log(`✅ SUCCESS! New balance for ${userId}: ${user.tokenCredits.toLocaleString()} tokens`);
      return res.status(200).send(`Tokens added successfully: ${tokenCredits}`);
    }
    
    // Not a payment success event
    console.log('ℹ️ Event processed (not a payment success)');
    res.status(200).send('Webhook processed (not a success event)');
    
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).send('Error processing webhook');
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => 
  console.log(`\n webhook server running on port ${PORT}\n\n✅ STEP 2 COMPLETE! ✅\n`)
);
