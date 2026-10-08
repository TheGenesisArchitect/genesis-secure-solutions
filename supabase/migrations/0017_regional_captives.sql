-- Regional captive carriers that are large in the pilot states (GA, AL, FL, TX). Without them, their offices
-- would be filed as independent agencies. Counts stay blank until confirmed from each carrier's own document.
-- Matching tries the longest alias first, so "Georgia Farm Bureau" wins over the generic "Farm Bureau".
insert into carriers (slug, name, aliases, query, model, lines, fit_score, fit_reasons, verified, marketing_notes) values
 ('georgia-farm-bureau', 'Georgia Farm Bureau Insurance', '{"Georgia Farm Bureau"}', 'Georgia Farm Bureau Insurance agent', 'exclusive', '{"auto","home","farm","life"}', 78,
   '{"Large exclusive agent network in Georgia","County offices with thin web presence"}', false, 'Pilot state (GA); count to be confirmed.'),
 ('alfa', 'Alfa Insurance', '{"Alfa Insurance","Alfa Mutual"}', 'Alfa Insurance agent', 'exclusive', '{"auto","home","farm","life"}', 78,
   '{"Exclusive agents across Alabama and neighbors","Local offices that market in their towns"}', false, 'Pilot state (AL); count to be confirmed.'),
 ('florida-farm-bureau', 'Florida Farm Bureau Insurance', '{"Florida Farm Bureau"}', 'Florida Farm Bureau Insurance agent', 'exclusive', '{"auto","home","farm","life"}', 74,
   '{"Exclusive agents across Florida counties"}', false, 'Pilot state (FL); count to be confirmed.'),
 ('texas-farm-bureau', 'Texas Farm Bureau Insurance', '{"Texas Farm Bureau"}', 'Texas Farm Bureau Insurance agent', 'exclusive', '{"auto","home","farm","life"}', 76,
   '{"Large exclusive agent network in Texas","County offices with thin web presence"}', false, 'Pilot state (TX); count to be confirmed.'),
 ('farm-bureau-other', 'Farm Bureau (other states)', '{"Farm Bureau"}', null, 'exclusive', '{"auto","home","farm","life"}', 70,
   '{"State Farm Bureau insurers run exclusive county offices"}', false, 'Catch-all so any state Farm Bureau office is never filed as independent; searched through the state-specific entries above.')
on conflict (slug) do nothing;
