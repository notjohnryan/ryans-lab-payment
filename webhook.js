app.post('/webhook', async (req, res) => {
  const data = req.body.data;
  if (data?.type === 'checkout_session.payment.paid') {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
      await client.connect();
      const metadata = data.attributes.metadata;
      const db = client.db("test");
      const userId = metadata.userId;

      console.log(`🔍 Searching for User: ${userId}`);

      // 1. Prepare all possible ID formats
      const asObjectId = userId.length === 24 ? new ObjectId(userId) : null;
      
      // 2. Search both collections/fields using an OR filter
      // This covers: _id as Object, _id as String, and the 'user' field
      const query = {
        $or: [
          { _id: asObjectId },
          { _id: userId },
          { user: asObjectId },
          { user: userId }
        ]
      };

      // 3. Try updating the 'users' collection first
      let result = await db.collection('users').updateOne(query, { 
        $inc: { "balances.tokenCredits": parseInt(metadata.token_credits) },
        $set: { "balances.last_topup": new Date() }
      });

      // 4. If not found in 'users', try updating the 'balances' collection
      if (result.matchedCount === 0) {
        console.log("⚠️ Not found in 'users', trying 'balances' collection...");
        result = await db.collection('balances').updateOne(query, {
          $inc: { "tokenCredits": parseInt(metadata.token_credits) },
          $set: { "last_topup": new Date() }
        });
      }

      if (result.matchedCount > 0) {
        console.log(`✅ SUCCESS: Match found and updated!`);
      } else {
        console.error(`❌ FAILURE: No document found in either collection for ID: ${userId}`);
      }
    } catch (err) {
      console.error("❌ DB ERROR:", err.message);
    } finally {
      await client.close();
      return res.status(200).send('OK');
    }
  }
});
