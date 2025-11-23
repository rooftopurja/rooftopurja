=== AUTHENTICATION STRATEGY ===

LOCAL DEVELOPMENT:
- No authentication required
- All functions use authLevel: "anonymous"
- Perfect for testing and development

PRODUCTION DEPLOYMENT:
1. ENABLE AUTHENTICATION (When ready):
   - Azure Portal → Your Static Web App → Authentication
   - Click "Add identity provider"
   - Choose Azure Active Directory or others
   - Configure redirect URLs

2. UPDATE FUNCTIONS FOR PRODUCTION:
   - Change authLevel from "anonymous" to "function"
   - Functions will automatically get user context
   - Add RLS (Row Level Security) based on user email

3. USERPLANTACCESS TABLE STRUCTURE:
   - PartitionKey: user@email.com
   - RowKey: plant-id
   - Columns: plantName, accessLevel, etc.

4. SECURITY NOTES:
   - Start with anonymous for development
   - Enable auth when going to production
   - Use environment variables for secrets
   - Implement proper error handling

CURRENT STATUS: Development mode (no auth)
NEXT STEPS: Test locally, then enable auth for production
