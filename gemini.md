# FiberTrack Project Constitution

## North Star
A nutrition tracking app that helps users optimize macros, fiber intake, glycemic load, and body weight through daily tracking and weekly planning.

---

## Core Domains

### 1. Meals
- meals
- meal_items
- foods
- macro calculations

### 2. Weight
- weight_entries
- trends
- moving averages

### 3. Planning
- weekly_plans
- weekly_plan_items

### 4. Analytics
- statistics
- correlations
- trends

---

## Data Sources

- Supabase (primary database)
- User input (manual logging)
- Future: image-based input

---

## Data First Rule

All features must:
1. define data structure first
2. define data flow
3. define calculations
4. THEN implement UI

---

## Architectural Rules

- No business logic in UI components
- All calculations must be pure functions
- Data fetching must be centralized
- Domains must not directly depend on each other

---

## Deliverables Standard

Every feature must include:
- data layer
- calculations
- UI integration
- edge case handling

---

## Performance Rules

- avoid large context conversations
- use new chats for new tasks
- one task per message

---

## Future Expansion

- AI meal input
- recommendation engine
- macro optimization

---

## Operating Rules

- Follow data-first approach

- One task per message

- Keep solutions simple and maintainable

- No business logic inside UI components