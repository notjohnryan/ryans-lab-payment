app.post('/webhook', async (req, res) => {
  const data = req.body.data;
  if (data?.type === 'checkout_session.payment.paid') {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
      await client.connect();
      const metadata = data.attributes.metadata;
      const db = client.db("test");
      const userId = metadata.userId;
      const amount = parseInt(metadata.token_credits);

      // 1. ADDRESSING THE ObjectId vs String issue
      // This converts your string ID into the purple 'ObjectId' format Mongo uses
      let queryId;
      try {
        queryId = new ObjectId(userId);
      } catch (e) {
        queryId = userId; // Fallback to string if conversion fails
      }

      // 2. SEARCH BOTH FIELDS (_id and user)
      const query = { 
        $or: [
          { _id: queryId }, 
          { _id: userId }, 
          { user: queryId }, 
          { user: userId }
        ] 
      };

      const updateData = { 
        $inc: { "tokenCredits": amount },
        $set: { "last_topup": new Date() }
      };

      // 3. TARGET THE 'balances' COLLECTION
      const result = await db.collection('balances').updateOne(query, updateData);

      if (result.modifiedCount > 0) {
        console.log(`✅ SUCCESS: Tokens added to ${userId} (ObjectId match)`);
      } else if (result.matchedCount > 0) {
        console.log(`⚠️ MATCHED BUT NOT UPDATED: Check if field name is exactly 'tokenCredits'`);
      } else {
        console.log(`❌ NOT FOUND: Could not find ${userId} in balances collection.`);
      }

    } catch (err) {
      console.error("❌ DB ERROR:", err.message);
    } finally {
      await client.close();
      return res.status(200).send('OK');
    }
  }
});
