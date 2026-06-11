const express = require('express');
const router = express.Router();
const userPreferencesController = require('../controllers/userPreferencesController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

router.use(verifyToken);

// Recent Views
router.post('/recent-views', userPreferencesController.addRecentView);
router.get('/recent-views', userPreferencesController.getRecentViews);

// Favourites
router.post('/favourites', userPreferencesController.addFavourite);
router.get('/favourites', userPreferencesController.getFavourites);
router.delete('/favourites/:id', userPreferencesController.removeFavourite);

module.exports = router;
