const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json()); // Required for PayMongo webhooks

// ⚠️ CRITICAL: Get this secret from PayMongo later (step 3)
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || 'temp_secret';

// Validate PayMongo webhook signatures
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

// This is where tokens will be added automatically
app.post('/webhook', validateWebhook, (req, res) => {
  const event = req.body.data;
  
  // Only process successful payments
  if (event.attributes.type === 'checkout.session' && 
      event.attributes.data.attributes.payment_intent.attributes.status === 'succeeded') {
    
    console.log('✅ PAYMENT SUCCESSFUL! Tokens would be added here');
    console.log('Mock data: User would get 5,000,000 tokens');
    
    return res.status(200).send('Tokens added (mock)');
  }
  
  res.status(200).send('Webhook processed (not a success event)');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Webhook server running on port ${PORT}`));
