const { createApp } = require('./app');

const port = process.env.ARC_DEV_PORT || process.env.PORT || 3000;
const app = createApp();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
