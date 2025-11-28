export interface LiveStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string;
  added: string;
  category_id: string;
  custom_sid: string;
  tv_archive: number;
  direct_source: string;
  tv_archive_duration: number;
}

export interface VODStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  container_extension: string;
  custom_sid: string;
  direct_source: string;
  added: string;
  category_id: string;
  rating: string;
  rating_5based: number;
  backdrop_path: string[];
  youtube_trailer: string;
  episode_run_time: string;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  release_date: string;
  tmdb_id: string;
}

export interface Series {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  release_date: string;
  last_modified: string;
  rating: string;
  rating_5based: number;
  backdrop_path: string[];
  youtube_trailer: string;
  episode_run_time: string;
  category_id: string;
  tmdb_id: string;
}

export interface Category {
  category_id: string;
  category_name: string;
  parent_id: number;
}