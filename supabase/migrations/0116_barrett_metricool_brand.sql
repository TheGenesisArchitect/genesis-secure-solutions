-- Barrett Family Agency's own Metricool brand (made 2026-11-18 by the operator): its approved posts go out from it
-- and its social numbers come back from it, never from Genovus's brand.
update tenants set metricool_blog_id = '8209605' where slug = 'tyson-barrett-geico-insurance-agent' and metricool_blog_id is distinct from '8209605';
