import React from 'react';
import { Image, StyleProp, View, ImageStyle } from 'react-native';
import { getBundledImage } from '../utils/images';

interface Props {
  imageKey?: string;
  photoUri?: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
}

export function AppImage({ imageKey, photoUri, style, resizeMode = 'cover' }: Props) {
  if (photoUri) {
    return <Image source={{ uri: photoUri }} style={style} resizeMode={resizeMode} />;
  }
  const bundled = getBundledImage(imageKey);
  if (bundled) {
    return <Image source={bundled} style={style} resizeMode={resizeMode} />;
  }
  return <View style={style} />;
}
