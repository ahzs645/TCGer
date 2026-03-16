import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as newsService from '../../modules/news/news.service';

export const newsRouter = Router();

// News feeds are public (no auth required)
newsRouter.get('/', asyncHandler(async (req, res) => {
  const tcg = req.query.tcg as string | undefined;
  const news = await newsService.getNews(tcg);
  res.json(news);
}));
