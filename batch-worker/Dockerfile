FROM node:22-alpine

WORKDIR /app
COPY package.json tsconfig.json /app/
RUN npm install
COPY src /app/src

CMD ["npm", "run", "start"]
