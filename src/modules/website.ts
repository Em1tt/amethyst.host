// imports
import express         from "express";
import morgan          from "morgan";
import path            from "path";
import fs              from "fs";
import * as eta        from "eta";
import config          from "../config.json";
import { util }        from "../util";
import { Endpoint }    from "../types/endpoint";
import helmet          from "helmet"
import cookieParser    from "cookie-parser"
import { auth }        from "./api/auth"
import * as plans      from "../plans.json"
import { Ticket }      from "../types/billing/ticket";
import { UserData }    from "../types/billing/user";
import { permissions } from "./permissions";
import permIDs         from "../permissions.json";
import rateLimit       from "express-rate-limit";
import { cdn }         from "./cdn"

import redis           from 'redis';
import ms              from 'ms';

const redisClient: redis.Client = redis.createClient({ password: process.env.REDIS_PASSWORD, user: "default" });
redisClient.on("connect", function() {
    util.log("[Redis] Connected to Database.")
    redisClient.db = { // Functions to make redis more easier to use than having a bunch of callback functions.
      get: function(key: string): any {
        return new Promise((resolve, reject): any => {
          redisClient.get(key, function(err, res) {
            if (err) return reject(err);
            resolve(res);
          })
        })
      },
      hget: function(key: string, field: any): any {
        return new Promise((resolve, reject) => {
          redisClient.hget(key, field, function(err, res) {
            if (err) return reject(err);
            resolve(res);
          })
        })
      },
      hmget: function(key: string, fields: Array<any>): any {
        return new Promise((resolve, reject) => {
          redisClient.hmget(key, fields, function(err, res) {
            if (err) return reject(err);
            resolve(res);
          })
        })
      },
      incr: function(key: string): any {
        return new Promise((resolve, reject) => {
          redisClient.incr(key, function(err, res) {
            if (err) return reject(err);
            resolve(res);
          })
        })
      },
      hgetall: function(key: string): any {
        return new Promise((resolve, reject) => {
          redisClient.hgetall(key, function(err, res) {
            if (err) return reject(err);
            resolve(res);
          })
        })
      },
      hexists: function(key: string, field: any): Promise<any> {
        return new Promise((resolve, reject) => {
          redisClient.hexists(key, field, function(err, res) {
            if (err) return reject(err);
            resolve(res);
          })
        })
      },
      exists: function(key: string): Promise<any> {
        return new Promise((resolve, reject) => {
          redisClient.exists(key, function(err, res) {
            if (err) return reject(err);
            resolve(res);
          })
        })
      },
      hset: function(values: Array<string | number>): Promise<any> {
        return new Promise((resolve, reject) => {
          redisClient.hset(values, function(err, res) {
            if (err) return reject(err);
            resolve(res);
          })
        })
      }
      
    }
})
redisClient.JWToptions = {
  RTOptions: { // Refresh Token Options
    expiresIn: ms('7 days'),
    issuer: "Ametrine Host (1.0)"
  },
  ATOptions: { // Access Token Options
    expiresIn: ms('1h'),
    issuer: "Ametrine Host (1.0)"
  },
  RTOptionsRemember: {
    expiresIn: ms('90 days'),
    issuer: "Ametrine Host (1.0)"
  }
}
redisClient.on("error", function(error) {
    util.log("[Redis] ERROR" + "\n" + error)
})


//import cors       from "cors"
const app : express.Application = express();
const html: string = path.join(__dirname, "views", "html");
const billing: string = path.join(__dirname, "views", "billing", "html");

const endpoints: Map<string, Endpoint> = new Map();
const files    : Array<string>         = fs.readdirSync(`./dist/modules/api`)
                                           .filter((f) => f.endsWith(".js"));

for (const f of files) {
  const ep: Endpoint = require(`./api/${f.replace(".js", "")}`);
  endpoints.set(ep.prop.name, ep);
  if (ep.prop["rateLimit"]) {
    app.use("/api/" + ep.prop.name + "*", rateLimit({
      windowMs: ep.prop["rateLimit"].time,
      max: ep.prop["rateLimit"].max,
      message: "You are sending too many API requests! Please try again later.",
    }));
    // There could be another solution for doing this.
  }
  if (ep.prop["setClient"]) { // Set redis without having to require redis in all API endpoints
    ep.prop["setClient"](redisClient);
  }
}
util.expressLog(`${endpoints.size} api endpoints loaded`);

app.use(cookieParser())

// 30 requests every 40 seconds
const apiLimiter = rateLimit({
  windowMs: 40 * 1000, // 40 seconds
  max: 30,
  message: "You are sending too many API requests! Please try again later."
});

app.use(morgan("[express]\t:method :url :status :res[content-length] - :response-time ms"));

// serve static files
app.use(express.static(path.join(__dirname, "views")));

// Create Parse for application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false })) // Required for req.body
app.use('/api/order/webhook', express.raw({type: 'application/json'}));
// Create Parse for application/json
app.use(express.json())
// Create Parse for Cookies

// Using Helmet to mitigate common security issues via setting HTTP Headers, such as XSS Protect and setting X-Frame-Options to sameorigin, meaning it'll prevent iframe attacks
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true, // nonce when
      directives: {
        defaultSrc: ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "hcaptcha.com", "*.hcaptcha.com", "cdn.quilljs.com", "static.cloudflareinsights.com", "unpkg.com", "cdn.jsdelivr.net", "ajax.googleapis.com", "*.gstatic.com", "js.stripe.com", "pixijs.download"],
        "style-src": ["'self'", "'unsafe-inline'", "hcaptcha.com", "*.hcaptcha.com", "cdn.quilljs.com", "unpkg.com", "fonts.googleapis.com", "*.gstatic.com", "use.fontawesome.com", "fontawesome.com"],
        "script-src-attr": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "https: data:"],
        "frame-src": ["'self'", "hcaptcha.com", "*.hcaptcha.com"],
        "connect-src": ["'self'", "hcaptcha.com", "*.hcaptcha.com"]
      }
    },
    xssFilter: true
  }
));

// eta
app.engine("eta", eta.renderFile);
app.set("view engine", "eta");

app.use(async (r: express.Request, s: express.Response, next: express.NextFunction) => {
  const userData = await auth.getUserData(r, s)
  s.locals.userData = userData
  next()
})



app.get("/", (r: express.Request, s: express.Response) => {
  s.render(`${html}/index.eta`);
});

// Probably another method to do this, but this is the best I can think of right now.
const apiMethod = function (r: express.Request, s: express.Response) {
  const ep: Endpoint = endpoints.get(r.params.method)
  if (ep) { // Prevent site from sending errors when the :method is not defined.
    ep.prop.run(r, s);
  } else {
    return s.render(`${html}/404.eta`);
  }
}
/* amethyst.host/api/bill
   amethyst.host/api/auth
   and so on..            */
app.all("/api/:method*", apiLimiter, (r: express.Request, s: express.Response) => {
  apiMethod(r, s);
});
// billing
app.get("/billing", (r: express.Request, s: express.Response) => {
  // You could use ETA and test whether or not it._locals.userData isnt null, and if it is then show stuff like Manage Account, similar to how you have "(!it.name.length) ?" in index.eta
  const userData = s.locals.userData;
  console.log(userData, config.billing);
  s.render(`${billing}/index.eta`, {
    userdata: userData,
    config: config.billing
  }
);
});
app.get("/billing/order", (r: express.Request, s: express.Response) => {
  //console.log(r);
  const file = `${billing}/order.eta`;

  if (!fs.existsSync(file)) return s.render(`${html}/404.eta`);
  let id = r.query?.id?.toString(); //Optional chaining. Thank you ECMA!
  let item = r.query?.type?.toString();
  if(!id){
    id = "0"
  }
  if(!item){
    id = "vps"
  }
  let details = plans?.[item]?.[id];
  if(!details){ //Default values so the backend doesn't shit itself when someone forges queries
      id = "0";
      item = "vps";
      details = plans[item][id];
  }
    const desc = plans[item].description;
    console.log(details);
    const userData = s.locals.userData;
  s.render(file, {
    details: details,
    item: item,
    itemid: id,
    description: desc,
    userData: userData,
    config: config.billing
  });
});

app.get("/billing/staff", async (r: express.Request, s: express.Response) => {
  const userData: UserData = s.locals.userData;
  const file = `${billing}/staff/overview.eta`;
  return redisClient.keys("user:?", async function (err, result) {
      if (err) {
        console.error(err);
        return s.status(500).send("An error occurred while retrieving the announcements. Please report this.")
      }
      const users: Array<UserData> = await Promise.all(result.map(async userID => {
        const user: UserData = await redisClient.db.hgetall(userID);
        return {id: user.user_id, registered: user.registered, permission: user.permission_id};
    }))
    if(!userData) return s.status(403).send("Must be logged in to visit staff panel.") //THIS WILL LATER REDIRECT TO A STAFF LOGIN PAGE
    if(!permissions.hasPermission(`${userData.permission_id}`, `/staff/`)) return s.status(403).send("Insufficient permissions.");
    s.render(file, {
      userData: userData,
      config: config.billing,
      users: JSON.stringify(users),
      permissions: permIDs
    });
  })
});

app.get("/billing/:name", (r: express.Request, s: express.Response) => {
  const file = `${billing}/${r.params.name}.eta`;

  if (!fs.existsSync(file)) return s.render(`${html}/404.eta`);
  const userData = s.locals.userData;
  s.render(file, {
    userData: userData,
    config: config.billing
  });
});

app.get("/billing/staff/:name", async (r: express.Request, s: express.Response) => {
  const userData: UserData = s.locals.userData;
  const file = `${billing}/staff/${r.params.name}.eta`;
  return redisClient.keys("user:?", async function (err, result) {
      if (err) {
        console.error(err);
        return s.status(500).send("An error occurred while retrieving the announcements. Please report this.")
      }
      const users: Array<UserData> = await Promise.all(result.map(async userID => {
        const user: UserData = await redisClient.db.hgetall(userID);
        return {id: user.user_id, registered: user.registered, permission: user.permission_id};
    }))
    if(!userData) return s.status(403).send("Must be logged in to visit staff panel.") //THIS WILL LATER REDIRECT TO A STAFF LOGIN PAGE
    if(!permissions.hasPermission(`${userData.permission_id}`, `/staff/${r.params.name}`)) return s.status(403).send("Insufficient permissions.");
    s.render(file, {
      userData: userData,
      config: config.billing,
      users: JSON.stringify(users),
      permissions: permIDs
    });
  })
});

app.get("/billing/tickets/create", (r: express.Request, s: express.Response) => {
  const file = `${billing}/tickets/create.eta`;

  if (!fs.existsSync(file)) return s.render(`${html}/404.eta`);
  const userData = s.locals.userData;
  if(!userData) return s.status(403).send("Must be logged in to do this");
  const ticketCats = require("../../src/ticket_categories.json");
  s.render(file, {
    userData: userData,
    config: config.billing,
    ticket_categories: ticketCats
  });
});

app.get("/billing/tickets/:ticketID", async (r: express.Request, s: express.Response) => {
  const file = `${billing}/tickets/ticket.eta`,
    ticketID = r.params.ticketID;
    if(!parseInt(ticketID)) return s.status(404).send("ticket IDs are always numeric values.");


    // Will add priority to the fields.
  let getTicket : Ticket = await redisClient.db.hgetall(`ticket:${ticketID}`);
  if (!getTicket) return s.sendStatus(404); // just in case
  const newTicketProps = { ...getTicket};
  newTicketProps["ticket_id"] = parseInt(getTicket.ticket_id.toString());
  newTicketProps["user_id"] = parseInt(getTicket.user_id.toString());
  newTicketProps["status"] = parseInt(getTicket.status.toString());
  newTicketProps["opened"] = parseInt(getTicket.opened.toString());
  newTicketProps["closed"] = parseInt(getTicket.closed.toString());
  newTicketProps["createdIn"] = parseInt(getTicket.createdIn.toString());
  newTicketProps["editedIn"] = parseInt(getTicket.editedIn.toString());
  
  getTicket = newTicketProps;
  if (!fs.existsSync(file)) return s.render(`${html}/404.eta`);
  const userData: UserData = s.locals.userData;
  if(!userData) return s.status(403).send("Must be logged in to do this");
  if(userData.user_id != getTicket.user_id) return s.status(403).send("No permission");
  const ticketCats = require("../../src/ticket_categories.json");
  s.render(file, {
    userData: userData,
    config: config.billing,
    ticket_categories: ticketCats,
    ticket: getTicket,
  });
});
app.get("/.env", (r: express.Request, s: express.Response) => {
  s.redirect("https://youtu.be/dQw4w9WgXcQ");
});

// "smart" router
app.get("/:name", (r: express.Request, s: express.Response) => {
  const file = `${html}/${r.params.name}.eta`;

  if (!fs.existsSync(file)) return s.render(`${html}/404.eta`);
  s.render(file);

});

// start up the website
app.listen(config.website.port, () => {
  util.expressLog(`started website @${config.website.port}`);
  cdn.host();
});