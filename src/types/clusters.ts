export interface ClusterPost {
  id: string;
  content: string;
  platform?: string;
  createdAt?: string;
  likes?: number;
  reposts?: number;
  replies?: number;
  url?: string;
  imageUrl?: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  similarity?: number;
}

export interface TopicCluster {
  clusterId: number;
  label: string;
  posts: ClusterPost[];
  postCount: number;
  avgSimilarity: number;
}

export interface ClustersResponse {
  clusters: TopicCluster[];
  totalPosts: number;
  clusterCount: number;
  computedAt: string;
  source: string;
}

export type FeedSource = "timeline" | "trending" | "home";
