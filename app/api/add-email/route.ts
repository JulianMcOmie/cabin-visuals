import { NextRequest, NextResponse } from 'next/server';

// Import Airtable
import Airtable from 'airtable';

// Read Airtable credentials from environment variables
const apiKey = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID;
// Use 'Waitlist' as default if not specified, adjust if your table name is different
const tableName = process.env.AIRTABLE_TABLE_NAME || 'Waitlist'; // Changed default assumption

// Initialize Airtable base - only if key and baseId are present
let base: Airtable.Base | null = null;
if (apiKey && baseId) {
  base = new Airtable({ apiKey }).base(baseId);
} else {
  console.error("Airtable API Key or Base ID is missing. API route will not function correctly.");
}

// // Basic validation - Removed redundant console error here, handled above
// if (!apiKey || !baseId) {
//   console.error("Airtable API Key or Base ID is missing from environment variables.");
//   // In a real app, you might want more robust error handling or configuration checks
// }

// Placeholder for Airtable base initialization - Replaced with actual initialization above
// const base = new Airtable({ apiKey }).base(baseId);

export async function POST(request: NextRequest) {
  // Check for configuration errors or missing base object at the start of the request
  if (!base || !apiKey || !baseId) {
    return NextResponse.json({ error: 'Airtable configuration missing on the server.' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const email = body.email;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required and must be a string.' }, { status: 400 });
    }

    // --- Airtable Logic --- 
    try {
      await base(tableName).create([
        {
          fields: {
            'Email': email, // Assumes Airtable column name is 'Email'
          },
        },
      ]);
      
      return NextResponse.json({ message: 'Successfully added to waitlist!' }, { status: 200 });

    } catch (airtableError: any) {
      console.error('Airtable API error:', airtableError);
      // Provide a more specific error message if possible
      const errorMessage = airtableError.message || 'Failed to add email to the waitlist.';
      // Determine appropriate status code based on error type if needed
      let statusCode = 500;
      if (airtableError.statusCode) {
         statusCode = airtableError.statusCode;
      }
      // Avoid exposing sensitive details in the error response
      return NextResponse.json({ error: `Airtable error: ${errorMessage}` }, { status: statusCode });
    }
    // --- End Airtable Logic ---

    // Simulate success for now - Removed, replaced with actual logic above
    // return NextResponse.json({ message: 'Email received successfully (Airtable integration pending).' }, { status: 200 });

  } catch (error) {
    console.error('API route error:', error);
    if (error instanceof SyntaxError) { // Handle JSON parsing errors
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    // General fallback error
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 