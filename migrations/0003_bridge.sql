-- Picture bridge for when the two computers cannot open a direct link.
-- One latest frame per desk, overwritten in place. The peer secret is set
-- once, on the first poll, and is never returned in the roster.
alter table webrtc_peers add column if not exists secret text;

create table if not exists desk_frames (
  room text primary key,
  seq bigint not null,
  jpeg text not null,
  viewer text not null default '',
  updated_at timestamptz not null default now()
);
