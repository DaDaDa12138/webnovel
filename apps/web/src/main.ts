import { createApp } from "vue";
import { createPinia } from "pinia";
import Varlet from "@varlet/ui";
import "@varlet/ui/es/style";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

createApp(App).use(createPinia()).use(router).use(Varlet).mount("#app");
