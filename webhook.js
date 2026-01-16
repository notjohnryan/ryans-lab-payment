app.post('/webhook', async (req, res) => {
  console.log("⚡ Webhook Received");
  const body = req.body;
  
  // 1. PayMongo sends the session object inside data.attributes
  const resource = body.data?.attributes?.data || body.data; 
  const metadata = resource?.attributes?.metadata || resource?.metadata;

  if (body.data?.type === 'checkout_session.payment.paid' || body.data?.type === 'payment.paid') {
    if (!metadata || !metadata.userId) {
      console.error("❌ ERROR: No userId found in Webhook metadata. Received:", JSON.stringify(metadata));
      return res.status(200).send('OK');
    }

    const client = new MongoClient(process.env.MONGO_URI);
    try {
      await client.connect();
      const db = client.db("test");
      const userId = metadata.userId;
      const amount = parseInt(metadata.token_credits);

      console.log(`🎯 TARGET ACQUIRED: User ${userId} | Amount ${amount}`);
      
      // ... rest of your existing Audit/Update logic ...
