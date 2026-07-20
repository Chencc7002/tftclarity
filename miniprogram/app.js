App({
  globalData: {
    statusBarHeight: 20,
    navigationBarHeight: 44
  },
  onLaunch() {
    const system = wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    this.globalData.statusBarHeight = system.statusBarHeight || 20;
    this.globalData.navigationBarHeight = menu
      ? Math.max(44, (menu.top - this.globalData.statusBarHeight) * 2 + menu.height)
      : 44;
  }
});
