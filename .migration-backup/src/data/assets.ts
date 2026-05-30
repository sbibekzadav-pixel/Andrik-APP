type ImageSource = ReturnType<typeof require>;

export const bundledImages: Record<string, ImageSource> = {
  logo: require('../../assets/andrik/logo.png'),
  projector: require('../../assets/andrik/station-projector.png'),
  ps5Big: require('../../assets/andrik/station-ps5-big.png'),
  ps5Small: require('../../assets/andrik/station-ps5-small.png'),
  driving: require('../../assets/andrik/station-driving.png'),
  stock: require('../../assets/andrik/station-stock.png'),
  campa: require('../../assets/andrik/item-campa.png'),
  coke: require('../../assets/andrik/item-coke.png'),
  jelly: require('../../assets/andrik/item-jelly.png'),
  real: require('../../assets/andrik/item-real.png'),
  water: require('../../assets/andrik/item-water.png'),
  xtreme: require('../../assets/andrik/item-xtreme.png'),
  chips: require('../../assets/andrik/item-chips.png'),
};
