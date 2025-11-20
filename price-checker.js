const axios = require('axios');
const fs = require('fs');

const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;
const MAILERSEND_FROM_EMAIL = process.env.MAILERSEND_FROM_EMAIL; // e.g., noreply@yourdomain.com

// Load tracked items from data file
function loadItems() {
  try {
    if (fs.existsSync('tracked-items.json')) {
      return JSON.parse(fs.readFileSync('tracked-items.json', 'utf8'));
    }
  } catch (e) {
    console.log('No items file found');
  }
  return [];
}

// Save tracked items
function saveItems(items) {
  fs.writeFileSync('tracked-items.json', JSON.stringify(items, null, 2));
}

// Extract price from URL using simple scraping
async function checkPrice(url) {
  try {
    // Simple price extraction - in production you'd want more robust scraping
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const html = response.data;
    
    // Try to find price patterns
    const pricePatterns = [
      /\$(\d+\.?\d{0,2})/,
      /USD\s*(\d+\.?\d{0,2})/i,
      /price["\s:]+\$?(\d+\.?\d{0,2})/i
    ];
    
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const price = parseFloat(match[1]);
        if (price > 0 && price < 100000) {
          return price;
        }
      }
    }
  } catch (error) {
    console.error('Price check error:', error.message);
  }
  return null;
}

// Send email via MailerSend
async function sendEmail(to, subject, body) {
  try {
    const response = await axios.post('https://api.mailersend.com/v1/email', {
      from: {
        email: MAILERSEND_FROM_EMAIL
      },
      to: [
        {
          email: to
        }
      ],
      subject: subject,
      text: body,
      html: `<pre>${body}</pre>`
    }, {
      headers: {
        'Authorization': `Bearer ${MAILERSEND_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✓ Email sent to ${to}`);
  } catch (error) {
    console.error('Email error:', error.response?.data || error.message);
  }
}

// Main function
async function main() {
  console.log('🔍 Starting price check...');
  
  const items = loadItems();
  console.log(`Checking ${items.length} items...`);

  let changesDetected = 0;

  for (const item of items) {
    console.log(`Checking: ${item.name}`);
    
    const newPrice = await checkPrice(item.url);
    
    if (newPrice && newPrice !== item.currentPrice) {
      const change = newPrice - item.currentPrice;
      const percent = ((change / item.currentPrice) * 100).toFixed(1);
      const isDecrease = change < 0;
      
      console.log(`💰 Price change: ${item.name}: $${item.currentPrice} → $${newPrice}`);
      changesDetected++;
      
      // Send email
      const emailBody = `🔔 Max's App - Price Alert!

Product: ${item.name}
${isDecrease ? '📉 PRICE DROPPED!' : '📈 Price Increased'}

Previous Price: $${item.currentPrice.toFixed(2)}
New Price: $${newPrice.toFixed(2)}
Change: ${isDecrease ? '-' : '+'}$${Math.abs(change).toFixed(2)} (${isDecrease ? '' : '+'}${percent}%)

View Product: ${item.url}

---
Sent by Max's App - Price Tracker
Tracking since: ${new Date(item.priceHistory[0]?.date).toLocaleDateString()}`;

      await sendEmail(
        item.email,
        `${item.name} - Price ${isDecrease ? 'Drop' : 'Increase'} Alert! ${isDecrease ? '📉' : '📈'}`,
        emailBody
      );
      
      // Update price
      item.currentPrice = newPrice;
      item.lastChecked = new Date().toISOString();
      
      if (!item.priceHistory) item.priceHistory = [];
      item.priceHistory.push({
        price: newPrice,
        date: new Date().toISOString()
      });
    } else if (newPrice) {
      console.log(`✓ No change for ${item.name}: $${newPrice}`);
      item.lastChecked = new Date().toISOString();
    } else {
      console.log(`⚠️ Could not fetch price for ${item.name}`);
    }
    
    // Wait 2 seconds between checks to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  saveItems(items);
  console.log(`✅ Check complete! ${changesDetected} price changes detected.`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
