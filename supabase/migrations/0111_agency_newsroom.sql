-- The Agency Newsroom (vision: claude.ai/artifact/DCwqXZGnqR2oSj5E4ZXUk4). A tenant with a Newsroom profile is an agency
-- desk (lib/desk.ts): its own beats from local public sources, heat scored for its customers, scripts held to the
-- insurance copy rules, and posts that wait for the agency owner's approval. The Genovus house desk has no profile and
-- works exactly as before.
--   profile    {kind:'agency', agency, host, carrier_line, office, area{label, places[]}, lines[], audience, sign_off,
--               rules[], competitors[], approver:'owner'}
--   brief_to   where the morning brief is emailed (off until the operator approves a preview: brief_on)
-- Beats carry their own sources: {id, label, brief, lines[], queries[], must?, window_days?, nws?, national?}. An
-- agency beat files only stories tied to its area, unless it is national (recalls).
alter table newsroom_settings add column if not exists profile jsonb;
alter table newsroom_settings add column if not exists brief_to text;
alter table newsroom_settings add column if not exists brief_on boolean not null default false;

-- JAVA Agency (Mendez Hollis, GEICO Exclusive Agency, Columbus GA): the first agency desk. Free wire plus the brief
-- only; paid research stays a tap, under a low daily cap. Seeded once by slug (a re-run never overwrites edits).
insert into newsroom_settings (tenant_id, beats, voice, daily_cap_cents, profile)
select t.id,
  '[
    {"id":"weather","label":"Weather & storms","brief":"Watches, warnings, storms, hail, flooding, freezes and heat around Columbus and the Chattahoochee Valley: what to do before and after.","lines":["Auto","Home","Boat","RV"],"nws":true,"window_days":2,
     "queries":["Columbus GA weather","Columbus Georgia storm","Chattahoochee Valley weather","Phenix City weather","west Georgia severe weather"],
     "must":"storm|weather|rain|flood|hail|tornado|wind|freez|frost|heat|hurricane|tropical|watch|warning|thunder|ice|snow|temperature|forecast|cold"},
    {"id":"roads","label":"Roads & driving","brief":"Road work, closures, traffic changes, gas prices and Georgia driving rules that local drivers need to know.","lines":["Auto","Motorcycle"],"window_days":3,
     "queries":["Columbus GA traffic","Columbus Georgia road construction","GDOT Columbus","I-185 Columbus","Georgia gas prices","Georgia driving law"],
     "must":"road|traffic|lane|interstate|i-185|highway|construction|gdot|gas price|driv|vehicle|motorist|bridge|closure|detour|license|speed|parking|toll"},
    {"id":"recalls","label":"Recalls & safety","brief":"Vehicle, truck, motorcycle and RV recalls that local owners should check, and what to do about them.","lines":["Auto","Motorcycle","RV"],"window_days":4,"national":true,
     "queries":["NHTSA recall","vehicle recall","pickup truck recall","motorcycle recall","RV recall"],
     "must":"recall"},
    {"id":"benning","label":"Fort Benning families","brief":"Arrivals, moves, deployments and life around Fort Benning: what military families need to set up when they get to Columbus.","lines":["Auto","Renters","Home"],"window_days":7,
     "queries":["Fort Benning","Fort Benning soldiers families","Fort Benning Columbus"],
     "must":"benning|fort moore|soldier|army|military|pcs|deploy|veteran|troops|garrison"},
    {"id":"home","label":"Home & seasons","brief":"Housing, renting, power outages, fire safety and the seasons around the house in Columbus.","lines":["Home","Renters"],"window_days":4,
     "queries":["Columbus GA housing","Columbus Georgia apartment","Columbus GA power outage","Georgia home fire safety","Columbus Georgia homeowners"],
     "must":"home|house|housing|apartment|renter|rent|fire safety|outage|power|freez|pipe|roof|neighborhood|property|homeowner"},
    {"id":"water","label":"On the water & the road","brief":"Lake Harding, West Point Lake, the Chattahoochee, camping and riding season: getting out safely.","lines":["Boat","RV","Motorcycle"],"window_days":7,
     "queries":["Lake Harding","West Point Lake","Chattahoochee River Columbus","Georgia boating","Columbus GA motorcycle","Georgia camping"],
     "must":"lake|river|boat|boating|kayak|whitewater|camp|rv|motorcycle|ride|riders|park|trail|fishing|marina"},
    {"id":"community","label":"Columbus community","brief":"Events, local businesses and good news around Columbus and Phenix City. Brand awareness, never a sales pitch.","lines":["Brand"],"window_days":3,
     "queries":["Columbus GA","Uptown Columbus","Columbus Georgia event","Phenix City"]}
  ]'::jsonb,
  '["Warm, neighborly and plain: talk to one neighbor, not a crowd","Local first: name the place, the road, the lake, the weather","One thing to do today, said simply","End: I''m Mendez, your local GEICO office in Columbus"]'::jsonb,
  100,
  '{"kind":"agency","agency":"JAVA Agency LLC","host":"Mendez","carrier_line":"A GEICO Exclusive Agency","office":"6053 Veterans Pkwy Ste 201, Columbus, GA",
    "area":{"label":"Columbus, GA and the Chattahoochee Valley","places":["Columbus","Phenix City","Chattahoochee","Muscogee","Harris County","Fort Benning","Fort Moore","Lake Harding","West Point Lake","Midland","Fortson","Uptown","Veterans Pkwy","I-185","Russell County","LaGrange","Opelika"]},
    "lines":["Auto","Home","Renters","Motorcycle","RV","Boat"],
    "audience":"drivers, homeowners, renters, riders, boaters and military families around Columbus, GA",
    "sign_off":"I''m Mendez, your local GEICO office in Columbus. A GEICO Exclusive Agency.",
    "rules":["No prices, quotes, premiums or savings claims","Never say what a policy covers; say call us and we will review it with you","Only his lines: Auto, Home, Renters, Motorcycle, RV, Boat","Speak as his local office, never for GEICO corporate","Never name or compare other insurers or agencies","No fear and no tragedy hooks; never name anyone involved in a loss","Every fact comes from a linked source","English only"],
    "competitors":["State Farm","Allstate","Progressive","Farmers","Liberty Mutual","Nationwide","USAA","Travelers","COUNTRY Financial","Alfa","Farm Bureau","Erie","American Family","Safeco","The General","Direct Auto","Freeway"],
    "approver":"owner"}'::jsonb
from tenants t where t.slug = 'mendez-hollis'
on conflict (tenant_id) do nothing;
