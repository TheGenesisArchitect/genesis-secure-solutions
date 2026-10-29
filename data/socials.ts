// Genovus's own social profiles (the brand in Metricool: "Genovus Intelliware"). Shown in the site header and footer
// and listed for search engines (sameAs). Add TikTok and LinkedIn here once those profiles exist.
export type Social = { id: 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'linkedin'; name: string; url: string };

export const SOCIALS: Social[] = [
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/genovusintelliware/' },
  { id: 'facebook', name: 'Facebook', url: 'https://www.facebook.com/61595014457345' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/channel/UCPukNUTk8ZJJSzovTqAhICA' },
];
