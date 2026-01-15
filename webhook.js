app.post('/webhook', async (req, res) => {
  const data = req.body.data;
  console.log("⚡ Webhook detected. Type:", data?.type);

  if (data?.type === 'checkout_session.payment.paid') {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
      await client.connect();
      const metadata = data.attributes.metadata;
      const db = client.db("test");
      
      const query = { _id: metadata.userId.length === 24 ? new ObjectId(metadata.userId) : metadata.userId };
      
      const result = await db.collection('users').updateOne(query, { 
        $inc: { "balances.tokenCredits": parseInt(metadata.token_credits) },
        $set: { "balances.last_topup": new Date() }
      });

      if (result.modifiedCount > 0) {
        console.log(`✅ SUCCESS: Tokens added to ${metadata.userId}`);
      } else {
        console.log(`⚠️ User not found: ${metadata.userId}`);
      }
    } catch (err) {
      console.error("❌ DB ERROR:", err.message);
    } finally {
      await client.close();
      // WE SEND THE RESPONSE AT THE VERY END
      return res.status(200).send('OK');
    }
  } else {
    res.status(200).send('Ignored event');
  }
});
