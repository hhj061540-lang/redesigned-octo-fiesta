const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SMS Desk KV Worker Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; background: #f4f7f6; color: #333; }
        h1, h2 { color: #0051c3; }
        .card { background: #fff; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        code { background: #eee; padding: 2px 6px; border-radius: 4px; }
        ul { line-height: 1.6; }
    </style>
</head>
<body>
    <h1>📱 SMS Desk KV Worker Dashboard</h1>
    <div class="card">
        <h2>Available API Endpoints</h2>
        <ul>
            <li><code>GET /</code> - This dashboard</li>
            <li><code>POST /number?phone=+16501234567</code> - Add/Buy single number</li>
            <li><code>POST /numbers/generate?areaCode=650&count=49</code> - Generate bulk numbers (supports: 650, 215, 415, 523)</li>
            <li><code>GET /numbers</code> - List all stored numbers</li>
            <li><code>GET /number/search?phone=+16501234567</code> - Search specific number metadata</li>
            <li><code>DELETE /api/numbers?phone=+16501234567</code> - Delete number & clean associated SMS logs</li>
            <li><code>POST /sms?phone=+16501234567&sender=+14155552671&message=Hello</code> - Log incoming SMS</li>
            <li><code>GET /sms/logs?phone=+16501234567</code> - View SMS logs for a number</li>
            <li><code>DELETE /sms/log?key=...</code> - Delete specific SMS log entry</li>
        </ul>
    </div>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // 0. ROOT ENDPOINT (Returns HTML Dashboard)
      if (path === '/' && method === 'GET') {
        return new Response(htmlContent, {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' }
        });
      }

      // 1. BUY / ADD SINGLE NUMBER
      // POST /number?phone=+16501234567
      if (path === '/number' && method === 'POST') {
        const phone = url.searchParams.get('phone');
        if (!phone) return new Response('Missing phone parameter', { status: 400 });

        const data = {
          phone,
          purchasedAt: new Date().toISOString(),
          status: 'active'
        };

        await env.SMS_KV.put(`num:${phone}`, JSON.stringify(data));
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 2. GENERATE BATCH OF PHONE NUMBERS WITH AREA CODES (650, 215, 415, 523)
      // POST /numbers/generate?areaCode=650&count=49
      if (path === '/numbers/generate' && method === 'POST') {
        const allowedAreaCodes = ['650', '215', '415', '523'];
        let areaCode = url.searchParams.get('areaCode') || '650';
        
        if (!allowedAreaCodes.includes(areaCode)) {
          areaCode = '650'; // Default fallback
        }

        const count = parseInt(url.searchParams.get('count') || '49', 10);
        const generatedNumbers = [];

        for (let i = 0; i < count; i++) {
          const subscriberNumber = Math.floor(1000000 + Math.random() * 9000000);
          const phone = `+1${areaCode}${subscriberNumber}`;

          const data = {
            phone,
            areaCode,
            purchasedAt: new Date().toISOString(),
            status: 'active',
            generated: true
          };

          await env.SMS_KV.put(`num:${phone}`, JSON.stringify(data));
          generatedNumbers.push(data);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          count: generatedNumbers.length, 
          data: generatedNumbers 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 3. LIST NUMBERS
      // GET /numbers
      if (path === '/numbers' && method === 'GET') {
        const listed = await env.SMS_KV.list({ prefix: 'num:' });
        const numbers = [];
        
        for (const key of listed.keys) {
          const val = await env.SMS_KV.get(key.name);
          if (val) numbers.push(JSON.parse(val));
        }

        return new Response(JSON.stringify(numbers), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 4. SEARCH SPECIFIC NUMBER
      // GET /number/search?phone=+16501234567
      if (path === '/number/search' && method === 'GET') {
        const phone = url.searchParams.get('phone');
        if (!phone) return new Response('Missing phone parameter', { status: 400 });

        const val = await env.SMS_KV.get(`num:${phone}`);
        if (!val) {
          return new Response(JSON.stringify({ error: 'Number not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, data: JSON.parse(val) }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 5. DELETE NUMBER & ITS LOGS (Updated path to /api/numbers)
      // DELETE /api/numbers?phone=+16501234567
      if (path === '/api/numbers' && method === 'DELETE') {
        const phone = url.searchParams.get('phone');
        if (!phone) return new Response('Missing phone parameter', { status: 400 });

        // Delete number metadata record from KV
        await env.SMS_KV.delete(`num:${phone}`);

        // Clean up associated SMS logs for this number
        const logsList = await env.SMS_KV.list({ prefix: `sms:${phone}:` });
        for (const key of logsList.keys) {
          await env.SMS_KV.delete(key.name);
        }

        return new Response(JSON.stringify({ success: true, deleted: phone }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 6. LOG / RECEIVE SMS
      // POST /sms?phone=+16501234567&sender=+14155552671&message=Hello
      if (path === '/sms' && method === 'POST') {
        const phone = url.searchParams.get('phone');
        const sender = url.searchParams.get('sender');
        const message = url.searchParams.get('message');

        if (!phone || !message) {
          return new Response('Missing phone or message parameter', { status: 400 });
        }

        const timestamp = Date.now();
        const logData = {
          sender: sender || 'Unknown',
          recipient: phone,
          message,
          timestamp: new Date().toISOString()
        };

        await env.SMS_KV.put(`sms:${phone}:${timestamp}`, JSON.stringify(logData));
        return new Response(JSON.stringify({ success: true, logData }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 7. VIEW SMS LOGS FOR A NUMBER
      // GET /sms/logs?phone=+16501234567
      if (path === '/sms/logs' && method === 'GET') {
        const phone = url.searchParams.get('phone');
        if (!phone) return new Response('Missing phone parameter', { status: 400 });

        const listed = await env.SMS_KV.list({ prefix: `sms:${phone}:` });
        const logs = [];

        for (const key of listed.keys) {
          const val = await env.SMS_KV.get(key.name);
          if (val) logs.push(JSON.parse(val));
        }

        return new Response(JSON.stringify(logs), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 8. DELETE SPECIFIC SMS LOG
      // DELETE /sms/log?key=sms:+16501234567:1710000000000
      if (path === '/sms/log' && method === 'DELETE') {
        const logKey = url.searchParams.get('key');
        if (!logKey) return new Response('Missing log key parameter', { status: 400 });

        await env.SMS_KV.delete(logKey);
        return new Response(JSON.stringify({ success: true, deletedKey: logKey }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response('Endpoint not found', { status: 404 });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
