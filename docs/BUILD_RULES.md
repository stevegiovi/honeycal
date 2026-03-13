# HoneyCal Build Rules

## Core Product Scope
- Mobile app only
- Exactly two users only
- One shared partnership only
- Google Calendar only
- Voice button is a primary entry point
- Richer negotiation model for event coordination
- Final agreed event writes to both calendars

## Explicitly Out of Scope
- No chat
- No tasks
- No family management
- No social feed
- No extra relationship tools
- No feature creep

## Technical Rules
- Expo managed workflow
- React Native
- TypeScript
- Plain React Native styling
- Supabase is the backend platform
- Supabase Edge Functions for secure server-side work
- OpenAI for speech-to-text and structured extraction
- Database is source of truth
- Local device storage is never business truth

## Architecture Rules
- Shared data must belong to canonical partnership records
- No mirrored duplicate records per user
- Negotiation state machine must be explicit and centralized
- Google Calendar tokens must be handled securely on the backend
- Prefer boring, reliable patterns over clever ones
