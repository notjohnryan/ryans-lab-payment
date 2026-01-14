const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

let mongoose; // Will initialize later
let User;     // Will initialize later
let PAYMONGO_WEBHOOK_SECRET;

// Initialize AFTER server starts (avoids build-time secret access)
const initializeServices = async () => {
  try {
    // Get secrets at runtime (not build time!)
    PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;
    if (!PAYMONGO_WEBHOOK_SECRET) {
      throw new Error('PAYMONGO_WEBHOOK_SECRET is required!');
    }

    // Connect to MongoDB at runtime
    mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    // Define User model after DB connection
    const UserSchema = new mongoose.Schema({
      _id: { type: String, required: true },
      email: { type: String, unique: true },
      tokenCredits: { type: Number, default: 0 },
      lastTopUp: Date,
      createdAt: { type: Date, default: Date.now }
    });
    User = mongoose.model('User', UserSchema);

    console.log('✅ Services initialized successfully');
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1); // Exit since we can't function without these
  }
};

// Webhook validation middleware
const validateWebhook = (req, res, next) => {
  if (!PAYMONGO_WEBHOOK_SECRET) {
    console.error('❌ Webhook secret not initialized');
    return res.status(500).send('Server configuration error');
  }
  
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
    // Ensure services are initialized
    if (!User) {
      await initializeServices();
    }
    
    const event = req.body;
    
    // Log minimal event info (safe for builds)
    console.log('📥 Received webhook:', {
      id: event.data?.id,
      type: event.data?.attributes?.type,
      status: event.data?.attributes?.data?.attributes?.payment_intent?.attributes?.status
    });
    
    // Only process successful checkout sessions
    const isCheckoutSession = event.data?.attributes?.type === 'checkout.session';
    const isPaymentSucceeded = event.data?.attributes?.data?.attributes?.payment_intent?.attributes?.status === 'succeeded';
    
    if (isCheckoutSession && isPaymentSucceeded) {
      const metadata = event.data?.attributes?.data?.attributes?.metadata;
      
      // Critical info from PayMongo
      const userId = metadata?.user_id;
      const tokenCredits = parseInt(metadata?.token_credits || 0);
      
      if (!userId || !tokenCredits) {
        console.error('❌ Missing required metadata:', { userId, tokenCredits });
        return res.status(400).send('Invalid payment metadata');
      }
      
      console.log(`🏦 Processing payment for user: ${userId}`);
      console.log(`💰 Adding ${tokenCredits.toLocaleString()} tokens`);
      
      // Update user's token balance
      const user = await User.findOneAndUpdate(
        { _id: userId },
        { 
          $inc: { tokenCredits: tokenCredits },
          $set: { lastTopUp: new Date() }
        },
        { new: true, upsert: false }
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
app.listen(PORT, async () => {
  console.log(`\nWebhook server running on port ${PORT}`);
  await initializeServices(); // Initialize after server starts
});
