-- StudioNext: Runway joins the Studio's engines. A shot can now be made with Runway (Seedance 2.5, Gen-4.5, Act-Two
-- and the rest of its model hub, chosen per shot), alongside Veo, real screen captures, code-made cards and sources.

alter table studio_shots drop constraint if exists studio_shots_tool_check;
alter table studio_shots add constraint studio_shots_tool_check check (tool in ('flow','nano-banana','capture','edit','veo','source','runway'));
