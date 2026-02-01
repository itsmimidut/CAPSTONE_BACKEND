import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';

async function testGemini() {
  console.log('🧪 Testing Gemini API...\n');
  
  // Check if API key exists
  if (!process.env.GEMINI_API_KEY) {
    console.log('❌ GEMINI_API_KEY not found in .env file!');
    return;
  }
  
  console.log('✅ API Key found:', process.env.GEMINI_API_KEY.substring(0, 20) + '...');
  
  try {
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    console.log('📡 Sending test request...\n');
    
    // Send test message
    const result = await model.generateContent("Say hello");
    const response = result.response.text();
    
    console.log('✅ SUCCESS! Gemini is working!\n');
    console.log('Response:', response);
    
  } catch (error) {
    console.log('❌ FAILED!\n');
    console.log('Error:', error.message);
    
    if (error.message.includes('fetch failed')) {
      console.log('\n🔥 DIAGNOSIS: Network/Firewall is blocking Gemini API');
      console.log('Solutions:');
      console.log('- Try on different network (home WiFi, mobile hotspot)');
      console.log('- Check firewall/antivirus settings');
      console.log('- Contact IT department if on school/work network');
    } else if (error.message.includes('API key')) {
      console.log('\n🔑 DIAGNOSIS: API Key issue');
      console.log('Solutions:');
      console.log('- Verify key is correct in .env file');
      console.log('- Check if key is enabled in Google Cloud Console');
      console.log('- Generate new API key');
    } else {
      console.log('\n❓ Unknown error - check details above');
    }
  }
}

testGemini();
