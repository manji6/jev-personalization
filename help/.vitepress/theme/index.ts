import { h } from "vue";
import DefaultTheme from "vitepress/theme-without-fonts";
import HeroAsk from "./HeroAsk.vue";
import "./custom.css";
export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "home-hero-image": () => h(HeroAsk),
    }),
};
