# 🌍 Multi-Language AI Medicine Information System

An AI-powered medicine information assistant with **multi-language support** using OpenRouter AI. Users can search for medicine information in their preferred language and get FDA-verified data translated in real-time.

## ✨ Features

- 🔍 **Medicine Information Search**: Search for any medicine and get detailed FDA-verified information
- 🌐 **Multi-Language Support**: Translate results into 12+ languages
- 🤖 **AI-Powered Summaries**: Get easy-to-understand summaries using OpenRouter AI
- 💊 **Comprehensive Details**: Primary uses, how it works, side effects, warnings, and important notes
- 🎨 **Modern UI**: Clean, responsive design with dark mode support
- ⚡ **Real-time Translation**: Instant translation of medicine information

## 🌎 Supported Languages

- 🇺🇸 English
- 🇪🇸 Spanish
- 🇫🇷 French
- 🇩🇪 German
- 🇮🇹 Italian
- 🇵🇹 Portuguese
- 🇨🇳 Chinese
- 🇯🇵 Japanese
- 🇰🇷 Korean
- 🇸🇦 Arabic
- 🇮🇳 Hindi
- 🇷🇺 Russian

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- OpenRouter API key (required for both summaries and translations)

### Installation

1. **Clone or navigate to the project directory**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Copy the example environment file:
   ```bash
   cp .env.local.example .env.local
   ```
   
   Edit `.env.local` and add your API keys:
   ```env
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   LINGO_API_KEY=your_lingo_api_key_here  # Optional
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

4. **Get your API key**
   
   - **OpenRouter API Key** (Required): 
     - Sign up at [https://openrouter.ai](https://openrouter.ai)
     - Get your API key from [https://openrouter.ai/keys](https://openrouter.ai/keys)
     - This key is used for both AI summaries AND translations

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

## 📖 How to Use

1. **Select Your Language**: Click the language selector in the header (🇺🇸 English) and choose your preferred language

2. **Search for Medicine**: Type the name of any medicine in the search box (e.g., "ibuprofen", "aspirin")

3. **Get Translated Results**: The app will:
   - Fetch FDA data for the medicine
   - Generate an AI summary in English
   - Automatically translate everything to your selected language

4. **View Information**: See comprehensive details including:
   - Medicine name
   - Primary uses
   - How it works
   - Common side effects
   - Warnings and precautions
   - Important notes

## 🏗️ Architecture

### Components

- **`app/page.tsx`**: Main chat interface with medicine search
- **`app/components/LanguageSelector.tsx`**: Language selection dropdown
- **`app/context/LanguageContext.tsx`**: Language state management

### API Routes

- **`/api/medicine`**: Fetches FDA data and generates AI summaries
- **`/api/translate`**: Handles translation requests via lingo.dev API

### Key Technologies

- **Next.js 16**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS v4**: Modern styling
- **OpenRouter AI**: AI-powered summarization
- **lingo.dev API**: Professional translation service
- **OpenFDA API**: Official FDA medicine data

## 🔧 API Integration

### OpenRouter AI Translation

The app uses OpenRouter AI for both medicine summaries and translations. Benefits:

- **Single API key** - No need for multiple services
- **High-quality translations** - Uses Google Gemini Flash 1.5 8B model
- **Medical accuracy** - Maintains medical terminology precision
- **Cost-effective** - Unified billing for all AI features
- **Reliable** - Built on established AI infrastructure

The translation uses the same OpenRouter API with optimized prompts for accurate medical translation.

## 🎨 Customization

### Adding More Languages

Edit `app/context/LanguageContext.tsx` to add more languages:

```typescript
export const LANGUAGES: Language[] = [
  // ... existing languages
  { code: "your_code", name: "Language Name", flag: "🏳️" },
];
```

### Styling

All styles are in `app/globals.css`. The design supports:
- Light and dark modes
- Responsive layouts
- Custom color schemes

## 🐛 Troubleshooting

### Translation Not Working

- Verify your `OPENROUTER_API_KEY` is correct in `.env.local`
- Check the console for API errors
- Restart the development server after updating the API key
- Make sure you have sufficient credits on your OpenRouter account

### Medicine Not Found

- Try different spelling variations
- Check if the medicine has FDA approval
- Use generic names instead of brand names

### Build Errors

```bash
# Clear cache and reinstall
rm -rf .next node_modules
npm install
npm run dev
```

## 📝 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | ✅ Yes | Your OpenRouter API key for AI summaries and translations |
| `NEXT_PUBLIC_APP_URL` | ❌ Optional | Your app URL (default: localhost:3000) |

## 🚢 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

### Other Platforms

The app can be deployed on any platform supporting Next.js:
- Netlify
- Railway
- AWS
- DigitalOcean

Just make sure to set the environment variables in your hosting platform.

## 📄 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## ⚠️ Disclaimer

This application provides medicine information from FDA data for educational purposes only. Always consult a healthcare professional for medical advice, diagnosis, or treatment. Do not rely solely on this information for making medical decisions.

## 🙏 Acknowledgments

- OpenFDA for providing medicine data API
- OpenRouter for AI model access and translation services
- Google for the Gemini Flash model
- Next.js team for the amazing framework
